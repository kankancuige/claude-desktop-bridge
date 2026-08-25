import {createTaskMetadata} from '../tasks/task-metadata.mjs'

/**
 * 任务命令运行时：只编排一次输入的接收、上下文路由和 SDK 回合启动。
 * 所有副作用通过显式依赖注入，组合根不再承载任务业务实现。
 */
export function createTaskCommandRuntime(deps = {}) {
    const {
        sessions, taskInputQueue, sessionCoordinator, IM_SOURCES, log, loadCliSettings, VALID_MODEL_MODES,
        MODEL, decideTask, resolveTurnModelRoute, loadWfConfig, validateProviderModel,
        acceptSessionInput, rollbackSessionInput, appendSessionEvent, markVisibleSession,
        isUserSessionSource, broadcastDesktop, getBroadcastDesktop = () => broadcastDesktop, createTaskCompletionState, createTurnIdentity,
        createTaskWorkflowGate, initializeTaskWorkbenchSession, userPreferences, updateTaskState,
        taskCompletionEventForClient, broadcast, getBroadcast = () => broadcast, resolveSdkInputContent, buildTaskPitfallReminder,
        routeSkills, createSessionContextEnvelope, resolveContextReusePolicy,
        resolveProviderCapabilityProfile, buildModelHandoffPrompt, beginTurn,
        shouldCaptureTurnCheckpoint, closeSessionRuntime, startClaudeAgent, PushStream,
        loadAgentDefinitions, makeQueryOptions, getMakeQueryOptions = () => makeQueryOptions,
        startStreamPump, getStartStreamPump = () => startStreamPump, failPendingSessionInputs,
        autoTriggerWorkflow, persistTaskEvent = null,
    } = deps
    if (!sessions || !taskInputQueue || !sessionCoordinator || !IM_SOURCES) throw new TypeError('task runtime dependencies are required')

    function queueTaskEvent(session, type, payload) {
        if (typeof persistTaskEvent !== 'function') return
        session._pendingTaskEvents = session._pendingTaskEvents || []
        session._pendingTaskEvents.push({eventType: type, eventPayload: payload, createdAt: Number(payload?.at || Date.now())})
    }

    function reserveTaskEventRevisions(session) {
        if (!Array.isArray(session?._pendingTaskEvents) || session._pendingTaskEvents.length === 0) return
        // 事件序号需要跨进程重启避开旧投影；时间戳作为新进程的单调起点，不暴露给用户。
        session._taskEventRevision = Math.max(Number(session._taskEventRevision || 0), Date.now())
        for (const event of session._pendingTaskEvents) event.eventRevision = ++session._taskEventRevision
    }

    async function flushTaskEvents(session) {
        if (typeof persistTaskEvent !== 'function' || !Array.isArray(session?._pendingTaskEvents)) return
        const pending = session._pendingTaskEvents.splice(0)
        for (const event of pending) {
            try {
                await persistTaskEvent(session, event)
            } catch (error) {
                log.error({err: error, sessionId: session.id?.slice?.(0, 8), eventType: event.eventType}, 'Workbench 任务事件落库失败')
            }
        }
    }

    async function submitTaskCommand(command) {
    const sessionId = command.sessionId
    const s = sessions.get(sessionId)
    if (!s) return {type: 'message_rejected', messageId: command.messageId, code: 'session_not_found'}
    if (s._stopPromise) await s._stopPromise

    const source = command.source
    const userId = command.userId || null
    const desktopInput = !IM_SOURCES.has(source)
    const activeTurnInput = Boolean(s._generating || s.activeTurnId || s._pendingInputs?.length)
    // 必须在热刷新 Provider/模型前捕获旧投影，否则重建原因会被新的运行配置覆盖。
    const contextEnvelopeBeforeSettings = s.contextEnvelope || createSessionContextEnvelope(s)
    let acceptedInput = null
    let acceptedEventPersisted = false
    try {
        // 供应商只在回合边界刷新，避免补充消息中断正在执行的工具。
        if (!activeTurnInput) {
            const fresh = loadCliSettings()
            const key = fresh.env?.ANTHROPIC_AUTH_TOKEN || fresh.env?.ANTHROPIC_API_KEY || ''
            const url = fresh.env?.ANTHROPIC_BASE_URL || ''
            const prevUrl = s.providerBaseUrl || ''
            const prevKey = s.providerApiKey || ''
            if ((url && url !== prevUrl) || (key && key !== prevKey)) {
                if (s.queryOpts) s.queryOpts.model = null
                s.runtimeEnv = s.runtimeEnv || {}
                s.runtimeEnv.ANTHROPIC_BASE_URL = url
                s.runtimeEnv.ANTHROPIC_AUTH_TOKEN = key
                s.providerBaseUrl = url
                s.providerApiKey = key
                log.info({sessionId: sessionId.slice(0, 8), baseUrl: url?.slice(0, 40)}, '厂商配置变更，将重建 query')
            }
        }

        const cliSettingsForDecision = loadCliSettings()
        const requestedModelMode = desktopInput && VALID_MODEL_MODES.has(command.modelMode)
            ? command.modelMode
            : (s.modelMode || (command.model ? 'fixed' : 'auto'))
        const taskDecision = activeTurnInput && s.taskDecision
            ? s.taskDecision
            : decideTask({
                text: desktopInput && command.taskText?.trim() ? command.taskText : command.content,
                previousDecision: s.taskDecision,
                diffRisk: s.lastDiffRisk,
                attachmentEvidence: desktopInput && command.hasAttachments,
            })
        const taskRoute = resolveTurnModelRoute({
            activeTurn: activeTurnInput,
            currentMode: s.modelMode,
            currentModel: s.queryOpts?.model,
            currentTier: s.modelTier,
            modelMode: requestedModelMode,
            explicitModel: requestedModelMode === 'fixed' ? (command.model || s.queryOpts?.model) : '',
            decision: taskDecision,
            modelTiers: loadWfConfig().modelTiers,
            defaultModel: cliSettingsForDecision.model || s.queryOpts?.model || MODEL,
        })
        if (taskRoute.blockingReason) {
            return {
                type: 'message_rejected', messageId: command.messageId, code: taskRoute.blockingReason,
                message: taskRoute.blockingReason === 'power_model_required'
                    ? '当前高风险任务需要先配置 Power 模型'
                    : '当前供应商没有可用模型',
            }
        }
        const providerBaseUrl = cliSettingsForDecision.env?.ANTHROPIC_BASE_URL || s.providerBaseUrl || ''
        const compatibilityError = activeTurnInput ? null : validateProviderModel({baseUrl: providerBaseUrl, model: taskRoute.model})
        if (compatibilityError) {
            return {
                type: 'message_rejected', messageId: command.messageId, code: compatibilityError,
                message: '当前 Codex Relay 不支持所选模型，请在设置中为该档位配置 Codex 模型',
            }
        }
        if (!activeTurnInput) s.providerBaseUrl = providerBaseUrl

        const previousModelMode = s.modelMode || (s.queryOpts?.model ? 'fixed' : 'auto')
        acceptedInput = acceptSessionInput(s, source, command.messageId, userId, taskDecision)
        if (!acceptedInput.ok) {
            return acceptedInput.duplicate
                ? {type: 'message_duplicate', messageId: acceptedInput.messageId}
                : {type: 'message_rejected', messageId: command.messageId, code: acceptedInput.error, queuePosition: acceptedInput.queuePosition || 0}
        }
        try {
            const rootTaskId = `${sessionId}:${acceptedInput.turnId}`
            const metadata = !activeTurnInput ? createTaskMetadata({
                taskText: desktopInput ? command.taskText : '',
                content: command.content,
                source,
            }) : {}
            const inputMetadata = activeTurnInput ? createTaskMetadata({content: command.content, source}) : null
            const acceptedEvent = activeTurnInput
                ? buildTaskEventPayload('task/input-appended', s, {taskId: s.taskCompletionTaskId, turnId: acceptedInput.turnId, source, messageId: acceptedInput.messageId, queuePosition: acceptedInput.queuePosition, summary: inputMetadata.summary, requestText: inputMetadata.requestText})
                : buildTaskEventPayload('task/created', s, {taskId: rootTaskId, turnId: acceptedInput.turnId, source, messageId: acceptedInput.messageId, ...metadata})
            appendSessionEvent(s, acceptedEvent.type, acceptedEvent.payload, {critical: true})
            queueTaskEvent(s, acceptedEvent.type, acceptedEvent.payload)
            if (!activeTurnInput) {
                const accepted = buildTaskEventPayload('task/accepted', s, {taskId: rootTaskId, turnId: acceptedInput.turnId, source, messageId: acceptedInput.messageId, queuePosition: acceptedInput.queuePosition})
                appendSessionEvent(s, accepted.type, accepted.payload, {critical: true})
                queueTaskEvent(s, accepted.type, accepted.payload)
            }
            acceptedEventPersisted = true
        } catch (error) {
            rollbackSessionInput(s, acceptedInput)
            s._pendingTaskEvents = []
            acceptedInput = null
            log.error({err: error, sessionId: sessionId.slice(0, 8), source}, '任务接收事件持久化失败，已拒绝输入')
            return {
                type: 'message_rejected', messageId: command.messageId, code: 'session_event_persist_failed',
                message: '任务状态无法持久化，请检查磁盘后重试',
            }
        }

        if (!s.visibleSource && isUserSessionSource(source)) {
            if (!markVisibleSession(s.workDir, sessionId, s.lastSessionId, source)) {
                rollbackSessionInput(s, acceptedInput)
                s._pendingTaskEvents = []
                appendSessionEvent(s, 'task/rolled-back', {turnId: acceptedInput.turnId, reason: 'session_visibility_persist_failed'})
                acceptedInput = null
                return {type: 'message_rejected', messageId: command.messageId, code: 'session_visibility_persist_failed'}
            }
            s.visibleSource = source
            if (s.lastSessionId) {
                getBroadcastDesktop()(sessionId, {
                    type: 'session_visible', sessionId, historySessionId: s.lastSessionId, source,
                })
            }
        }

        if (!activeTurnInput) {
            s.taskStartedAt = Date.now()
            s.taskCompletedAt = 0
            s.taskCompletion = createTaskCompletionState({phase: 'running'})
            s.taskCompletionDecision = taskDecision
            // 自动 Memory 只读取本轮原始用户请求，避免把模型最终回复误当成事实来源。
            s.taskRequestText = String(desktopInput && command.taskText?.trim() ? command.taskText : command.content || '').slice(0, 12000)
            s.taskCompletionIdentity = createTurnIdentity(source, userId, IM_SOURCES)
            s.taskFinalReplyText = ''
            s.taskReviewFiles = []
            s.taskReviewCheckpointId = null
            s._finalReviewKey = null
            s.taskCompletionTurnId = acceptedInput.turnId
            s.taskCompletionTaskId = `${sessionId}:${acceptedInput.turnId}`
            s._taskCompletionSequence = 0
            s._taskWorkflowGate = createTaskWorkflowGate()
            s._internalWorkflowResultTurnId = null
            s._autoContinuationRequest = null
            s.autoContinuationCount = 0
            s.autoContinuationTurns = 0
            s._lastContextUsageAt = 0

            await initializeTaskWorkbenchSession({
                session: s,
                taskId: s.taskCompletionTaskId,
                turnId: acceptedInput.turnId,
                sessionId,
                source,
                userId,
                taskText: desktopInput ? command.taskText : '',
                content: command.content,
                goal: desktopInput && command.taskText?.trim() ? command.taskText : command.content,
                decision: taskDecision,
            })
        }

        // 只在新任务入口观察候选；同一执行中的补充消息不能把一次要求误计为多次偏好。
        let preferenceSuggestions = []
        if (!activeTurnInput) {
            try {
                preferenceSuggestions = userPreferences.observe({
                    projectDir: s.workDir,
                    taskId: s.taskCompletionTaskId || acceptedInput.turnId,
                    sessionId,
                    source,
                    text: desktopInput && command.taskText?.trim() ? command.taskText : command.content,
                })
            } catch (error) {
                log.warn({err: error, sessionId: sessionId.slice(0, 8)}, '用户偏好候选观察失败，继续执行任务')
            }
        }

        reserveTaskEventRevisions(s)
        updateTaskState(s, sessionId, {
            status: 'running', outcome: null, continuationReason: null,
            resumable: Boolean(s.lastSessionId), sdkSessionId: s.lastSessionId, historySessionId: s.lastSessionId,
            model: taskRoute.model,
            taskId: s.taskCompletionTaskId || null, turnId: s.taskCompletionTurnId || null,
            sequence: s._taskCompletionSequence || 0, startedAt: s.taskStartedAt || Date.now(),
            completedAt: 0, durationMs: 0,
            ...(s.taskMetadata || {}),
            projectKey: s.workDir || '',
        })
        await flushTaskEvents(s)
        if (!activeTurnInput) {
            taskCompletionEventForClient(s, sessionId, 'task_started', {
                modelTier: taskDecision.modelTier, risk: taskDecision.risk,
            })
        }
        s.taskDecision = taskDecision
        s.modelTier = taskRoute.tier || null
        getBroadcast()(sessionId, {
            type: 'task_decision', version: taskDecision.version, action: taskDecision.action,
            complexity: taskDecision.complexity, risk: taskDecision.risk, modelTier: taskDecision.modelTier,
            model: taskRoute.model, modelMode: taskRoute.mode, workflow: taskDecision.workflow,
            finalReview: taskDecision.finalReview, reasons: taskDecision.reasons,
            hardTriggers: taskDecision.hardTriggers, fallbackReason: taskRoute.fallbackReason,
            inheritedFromActiveTurn: taskRoute.inheritedFromActiveTurn, ts: Date.now(),
        })
        log.info({sessionId: sessionId.slice(0, 8), source, textLength: command.content.length}, '← 用户消息')
        if (IM_SOURCES.has(source)) {
            getBroadcastDesktop()(sessionId, {type: 'remote_user_message', source, content: command.content})
        }
        for (const suggestion of preferenceSuggestions) {
            getBroadcastDesktop()(sessionId, {type: 'preference_suggestion', suggestion})
        }
        s._pendingSources = s._pendingSources || []
        s._pendingSources.push(source)

        const srcLabel = IM_SOURCES.has(source) ? `[${source}] ` : ''
        const newPerm = IM_SOURCES.has(source) ? 'default' : command.permissionMode
        const newThink = command.thinkingLevel
        const newModel = taskRoute.model
        const nextProfile = taskDecision.contextProfile
        const permChanged = newPerm && newPerm !== s.permissionMode
        const thinkChanged = newThink && newThink !== s.thinkingLevel
        const modelChanged = newModel && newModel !== s.queryOpts?.model
        const modeChanged = taskRoute.mode !== previousModelMode
        const contextChanged = nextProfile !== (s.contextProfile || 'full')
        let sdkInputContent = await resolveSdkInputContent(sessionId, s, command.content)
            + (!activeTurnInput ? buildTaskPitfallReminder(s.taskPitfallReminders) : '')
        if (s.taskContextPlan) updateTaskState(s, sessionId, {...s.taskState, context: s.taskContextPlan})
        const nextSkillRoute = routeSkills({text: sdkInputContent, workDir: s.workDir, profile: nextProfile})
        const skillRouteChanged = JSON.stringify(nextSkillRoute) !== JSON.stringify(s.skillRoute || [])
        const nextAgentRoute = Array.isArray(s.agentRoute) ? s.agentRoute : []
        const agentRouteChanged = JSON.stringify(nextAgentRoute) !== JSON.stringify(s.loadedAgentRoute || [])
        const previousContextEnvelope = contextEnvelopeBeforeSettings
        const nextContextEnvelope = createSessionContextEnvelope({
            ...s,
            providerBaseUrl,
            permissionMode: newPerm || s.permissionMode,
            thinkingLevel: newThink || s.thinkingLevel,
            contextProfile: nextProfile,
            skillRoute: nextSkillRoute,
            loadedAgentRoute: nextAgentRoute,
            queryOpts: {
                ...s.queryOpts,
                model: newModel,
                bridgeProviderBaseUrl: providerBaseUrl,
                bridgeContextProfile: nextProfile,
                bridgeSkillRoute: nextSkillRoute,
            },
        })
        const contextReusePolicy = resolveContextReusePolicy({
            previous: previousContextEnvelope,
            next: nextContextEnvelope,
            providerCapability: resolveProviderCapabilityProfile(providerBaseUrl),
            switchIntent: command.contextSwitchMode,
        })
        if (contextReusePolicy.mode === 'handoff_summary') {
            sdkInputContent = buildModelHandoffPrompt({prompt: sdkInputContent, session: s})
        }
        beginTurn(sessionId, srcLabel + command.content, {
            captureFiles: shouldCaptureTurnCheckpoint(taskDecision),
        })

        if (permChanged || thinkChanged || modelChanged || modeChanged || contextChanged || skillRouteChanged || agentRouteChanged) {
            // SDK 的 resume 仅保证会话连续性，不能证明上游缓存命中或费用；事件不含 Provider 地址、Prompt 或凭据。
            getBroadcast()(sessionId, {
                type: 'context_rebuild_policy',
                policy: contextReusePolicy.mode,
                cacheEligibility: contextReusePolicy.cacheEligibility,
                reasonCodes: contextReusePolicy.reasonCodes,
                requiresUserChoice: contextReusePolicy.requiresUserChoice,
            })
            sessionCoordinator.setContextPolicy(s, contextReusePolicy)
            s.diagnostics?.record?.({
                phase: 'rebuild',
                rebuildReason: contextReusePolicy.reasonCodes?.join(',') || 'context_changed',
                usageSource: contextReusePolicy.cacheEligibility,
            })
            if (permChanged) s.permissionMode = newPerm
            if (thinkChanged) s.thinkingLevel = newThink
            if (modelChanged) {
                s.queryOpts.model = newModel
                if (command.modelMeta) s.modelMeta = command.modelMeta
            }
            if (contextChanged) s.contextProfile = nextProfile
            if (skillRouteChanged) s.skillRoute = nextSkillRoute
            if (agentRouteChanged) s.loadedAgentRoute = nextAgentRoute
            await closeSessionRuntime(s, {sessionId, reason: 'runtime_settings_changed'})
            s.query = null
            s.pushStream = null
            sessionCoordinator.invalidate(s)
            if (s._hasConversation) s.lastSessionId = s.lastSessionId || sessionId
        }
        s.modelMode = taskRoute.mode

        if (!s.query) {
            if (s._rebuildPromise) {
                sessionCoordinator.enqueue(s, sdkInputContent)
            } else {
                const rebuild = sessionCoordinator.beginRebuild(s, sdkInputContent)
                const myRebuildId = rebuild.token
                const rebuildPromise = (async () => {
                    const cliS = loadCliSettings()
                    const rebuildPushStream = new PushStream()
                    s.pushStream = rebuildPushStream
                    const bodyOverride = {
                        resume: contextReusePolicy.mode === 'handoff_summary'
                            ? undefined
                            : (s.hasUserTurns ? (s.lastSessionId || undefined) : undefined),
                        model: s.queryOpts?.model, modelMode: s.modelMode || 'fixed',
                        taskDecision: s.taskDecision || null, permissionMode: s.permissionMode,
                        thinkingLevel: s.thinkingLevel, contextProfile: s.contextProfile || 'full',
                        skillRoute: s.skillRoute || [], modelMeta: command.modelMeta,
                        projectContext: s.projectContext || null,
                        _agents: loadAgentDefinitions(s.taskDecision || null, s.projectContext || null),
                    }
                    if (s.providerBaseUrl) bodyOverride.baseUrl = s.providerBaseUrl
                    if (s.providerApiKey) bodyOverride.apiKey = s.providerApiKey
                    const opts = await getMakeQueryOptions()(bodyOverride, s.workDir, cliS, {}, sessionId)
                    if (!sessionCoordinator.isCurrent(s, myRebuildId) || s.pushStream !== rebuildPushStream) return
                    if (bodyOverride.resume) opts.resume = bodyOverride.resume
                    s.query = startClaudeAgent(rebuildPushStream, opts)
                    s.runtimeEnv = opts.runtimeEnv
                    s.providerBaseUrl = opts.bridgeProviderBaseUrl || s.providerBaseUrl
                    s.providerApiKey = opts.bridgeProviderApiKey || s.providerApiKey
                    s.queryOpts = opts
                    s.contextEnvelope = createSessionContextEnvelope(s, opts)
                    getStartStreamPump()(sessionId)
                    const pending = sessionCoordinator.consumePendingMessages(s, myRebuildId)
                    for (const content of pending) {
                        rebuildPushStream.push({
                            type: 'user', session_id: sessionId,
                            message: {role: 'user', content: [{type: 'text', text: content}]},
                            parent_tool_use_id: null,
                        })
                        s.hasUserTurns = true
                    }
                    sessionCoordinator.complete(s, myRebuildId)
                })().catch(error => {
                    if (!sessionCoordinator.isCurrent(s, myRebuildId)) {
                        log.debug({err: error, sessionId: sessionId.slice(0, 8)}, '已过期 rebuild 失败，忽略其状态清理')
                        return
                    }
                    log.error({err: error, sessionId: sessionId.slice(0, 8)}, 'rebuild 失败')
                    sessionCoordinator.fail(s, myRebuildId)
                    failPendingSessionInputs(sessionId, s, error)
                })
                sessionCoordinator.attachPromise(s, myRebuildId, rebuildPromise)
            }
        } else {
            s.pushStream.push({
                type: 'user', session_id: sessionId,
                message: {role: 'user', content: [{type: 'text', text: sdkInputContent}]},
                parent_tool_use_id: null,
            })
            s.hasUserTurns = true
        }

        if (!command.noWorkflow && !activeTurnInput) {
            autoTriggerWorkflow(sessionId, command.content, taskDecision).catch(error => {
                log.warn({err: error, sessionId: sessionId.slice(0, 8)}, 'autoTriggerWorkflow 异常')
            })
        }
        const result = {
            type: 'message_accepted', messageId: acceptedInput.messageId,
            turnId: acceptedInput.turnId, queuePosition: acceptedInput.queuePosition,
        }
        acceptedInput = null
        return result
    } catch (error) {
        if (acceptedInput && rollbackSessionInput(s, acceptedInput)) {
            s._pendingTaskEvents = []
            const sourceIndex = s._pendingSources?.lastIndexOf(source) ?? -1
            if (sourceIndex >= 0) s._pendingSources.splice(sourceIndex, 1)
            if (acceptedEventPersisted) appendSessionEvent(s, 'task/rolled-back', {
                turnId: acceptedInput.turnId,
                reason: typeof error?.code === 'string' ? error.code.slice(0, 120) : 'submit_failed',
            })
        }
        throw error
    }
}
    return {submitTaskCommand}
}
import {buildTaskEventPayload} from '../tasks/task-event-payload.mjs'
