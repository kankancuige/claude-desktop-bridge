/**
 * SDK Stream Runtime。
 *
 * 负责消费 SDK async iterable、维护回合边界、自动续跑和结果收口。
 * 组合根只通过显式依赖注入提供会话、任务、持久化和广播出口。
 */
import {createSdkStreamService} from './sdk-stream-service.mjs'
import {createTaskRunBudget} from '../tasks/task-run-budget.mjs'

export function createSdkStreamRuntime(deps = {}) {
    const {sessions, sessionCoordinator, PushStream, loadCliSettings, makeQueryOptions, startClaudeAgent, log, updateTaskCompletion, applyTaskCompletionEffects, broadcastTurn, taskStateForClient, taskStateForError, updateTaskState, failPendingSessionInputs, appendSessionEvent, persistSessionMirrors, persistSdkSessionId, sessionVisibilitySource, getProjectVisibility, markVisibleSession, broadcastDesktop, dynamicCache, builtinCache, persistDynamicCache, taskWorkflowResultIdFromMessage, consumeTaskWorkflowResultTurn, taskInputQueue, IM_SOURCES, createTurnIdentity, loadWfConfig, getWorkflow, runWfScript, finishTaskWorkflowResultTurn, hasPendingTaskWorkflow, consumePendingSessionInputOnResult, sdkStreamAdapter, broadcastTaskLifecycle, classifyTaskResult, resolveAutoContinuation, maybeUpdateProjectCache, finalizeCheckpoint, shouldCaptureTurnCheckpoint, beginTurn, resolveFinalReviewPlan, canResumeTask, deferPrimaryResultForTaskWorkflow, takeDeferredPrimaryResult, taskCompletionEventForClient, taskWorkbench, getTaskWorkbench, taskCoordinator, maybeInjectProjectCache, maybeInjectGitContext, clearTaskWorkflowGate, clearStreamWatchdog, markSessionDeleted, finishImProgressReporters, clearAdapterBindingsForSessions, invalidateProjectsCache, deleteSessionFiles, armStreamWatchdog, withTimeout, getStateStore, getSessionProjectKey, getFocusedSessionId, setFocusedSessionId} = deps
    if (!sessions || !sessionCoordinator || typeof consumePendingSessionInputOnResult !== 'function'
        || typeof broadcastTurn !== 'function'
        || !sdkStreamAdapter || typeof sdkStreamAdapter.toClientEvent !== 'function') {
        throw new TypeError('sdk stream runtime dependencies are required')
    }
    const sdkStreamService = createSdkStreamService({
        withTimeout,
        getStateStore,
        getSessionProjectKey,
        broadcast: broadcastTurn,
        logger: log,
    })
    const {refreshContextUsage, recordProviderUsage, maybeRefreshContextUsage} = sdkStreamService

async function startAutoContinuation(sessionId, session, request) {
    if (!session || sessions.get(sessionId) !== session || session._autoContinuationRequest !== request
        || !request?.prompt || !session.lastSessionId
        || !['running', 'fixing'].includes(session.taskCompletion?.phase)) return false
    const rebuild = sessionCoordinator.beginRebuild(session, request.prompt)
    if (!rebuild.started) return false
    const rebuildId = rebuild.token
    const pushStream = new PushStream()
    const rebuildPromise = (async () => {
        const cliS = loadCliSettings()
        session.pushStream = pushStream
        const bodyOverride = {
            resume: session.lastSessionId,
            model: session.queryOpts?.model,
            modelMode: session.modelMode || 'fixed',
            taskDecision: session.taskDecision || request.taskDecision || null,
            permissionMode: session.permissionMode,
            thinkingLevel: session.thinkingLevel,
            contextProfile: session.contextProfile || 'full',
            skillRoute: session.skillRoute || [],
            modelMeta: session.modelMeta || null,
            maxContextTokens: session.queryOpts?.bridgeContextSafetyCap || undefined,
            maxTurns: session.queryOpts?.maxTurns,
        }
        if (session.providerBaseUrl) bodyOverride.baseUrl = session.providerBaseUrl
        if (session.providerApiKey) bodyOverride.apiKey = session.providerApiKey
        const opts = await makeQueryOptions(bodyOverride, session.workDir, cliS, {}, sessionId)
        if (!sessionCoordinator.isCurrent(session, rebuildId) || session.pushStream !== pushStream
            || session._autoContinuationRequest !== request) return false
        opts.resume = session.lastSessionId
        session.query = startClaudeAgent(pushStream, opts)
        session.runtimeEnv = opts.runtimeEnv
        session.queryOpts = opts
        session.providerBaseUrl = opts.bridgeProviderBaseUrl || session.providerBaseUrl
        session.providerApiKey = opts.bridgeProviderApiKey || session.providerApiKey
        startStreamPump(sessionId)
        // query 已经接管续跑请求；后续追加消息只通过 _rebuildPromise 排队。
        session._autoContinuationRequest = null
        const pending = sessionCoordinator.consumePendingMessages(session, rebuildId)
        for (const content of pending) {
            pushStream.push({
                type: 'user', session_id: sessionId,
                message: {role: 'user', content: [{type: 'text', text: content}]},
                parent_tool_use_id: null,
            })
            session.hasUserTurns = true
        }
        sessionCoordinator.complete(session, rebuildId)
        return true
    })().catch(error => {
        if (!sessionCoordinator.isCurrent(session, rebuildId)) return false
        session._autoContinuationRequest = null
        sessionCoordinator.fail(session, rebuildId)
        session.pushStream = null
        session.query = null
        const detail = `自动续跑启动失败：${String(error?.message || error || '未知错误')}`
        log.error({err: error, sessionId: sessionId?.slice(0, 8)}, detail)
        const transition = updateTaskCompletion(session, sessionId, {type: 'runtime_failed', detail})
        void applyTaskCompletionEffects(sessionId, transition.effects).catch(effectError => {
            log.error({err: effectError, sessionId: sessionId?.slice(0, 8)}, '自动续跑失败后的任务收口失败')
            broadcastTurn(sessionId, {
                type: 'error', code: 'auto_continuation_failed', message: detail,
                durationMs: session.taskState?.durationMs || 0,
                taskState: taskStateForClient(session.taskState),
            }, request.identity || session.taskCompletionIdentity || null)
        })
        session._generating = false
        session.activeTurnId = null
        session.activeTurnIdentity = null
        const completedAt = Date.now()
        session.taskCompletedAt = completedAt
        const startedAt = Number(session.taskStartedAt || session.taskState?.startedAt || completedAt)
        updateTaskState(session, sessionId, taskStateForError(error, {
            sdkSessionId: session.lastSessionId,
            historySessionId: session.lastSessionId,
            startedAt,
            completedAt,
            durationMs: Math.max(0, completedAt - startedAt),
        }))
        return false
    })
    sessionCoordinator.attachPromise(session, rebuildId, rebuildPromise)
    await rebuildPromise
    return Boolean(session.query)
}

async function startStreamPump(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return
    const myQuery = s.query  // 记录此 pump 持有的 query 对象引用
    armStreamWatchdog(sessionId, s, myQuery)
    try {
        for await (const sdkMsg of myQuery) {
            armStreamWatchdog(sessionId, s, myQuery)
            maybeRefreshContextUsage(sessionId, s, `running:${sdkMsg.type || 'event'}`)
            if (sdkMsg.type === 'system' && sdkMsg.subtype === 'init') {
                if (sdkMsg.session_id) {
                    s.lastSessionId = sdkMsg.session_id; s._hasConversation = true
                    // SDK ID 到达后补写别名，保证 Gateway 重启/resume 后仍能恢复镜像开关。
                    if (!persistSessionMirrors(s, sessionId)) {
                        log.warn({sessionId: sessionId?.slice(0, 8)}, 'Session 镜像别名未持久化')
                    }
                    if (s.taskState?.status === 'running') {
                        updateTaskState(s, sessionId, {
                            ...s.taskState,
                            sdkSessionId: sdkMsg.session_id,
                            historySessionId: sdkMsg.session_id,
                            resumable: true,
                        })
                    }
                    // 持久化 gateway sessionId → SDK conversationId 映射，供重启 resume 使用
                    if (!persistSdkSessionId(s.workDir, sessionId, sdkMsg.session_id)) {
                        log.warn({sessionId: sessionId?.slice(0, 8)}, 'Session 映射未持久化，重启后可能无法续接')
                    }
                    const visibleSource = s.visibleSource
                        || sessionVisibilitySource(getProjectVisibility(s.workDir), sessionId, sdkMsg.session_id)
                    if (visibleSource) {
                        s.visibleSource = visibleSource
                        if (!markVisibleSession(s.workDir, sessionId, sdkMsg.session_id, visibleSource)) {
                            log.warn({sessionId: sessionId?.slice(0, 8)}, 'Session 可见性未持久化')
                        }
                        broadcastDesktop(sessionId, {
                            type: 'session_visible',
                            sessionId,
                            historySessionId: sdkMsg.session_id,
                            source: visibleSource,
                        })
                    }
                }
                // 顺手把 init 暴露的命令/agent 名单缓存下来，供设置页冷启动读取
                if (Array.isArray(sdkMsg.slash_commands)) {
                    dynamicCache.commands = sdkMsg.slash_commands.map(n => ({
                        name: n,
                        description: '',
                        argumentHint: ''
                    }));
                    dynamicCache.updatedAt = Date.now()
                }
                if (Array.isArray(sdkMsg.agents)) dynamicCache.agentNames = sdkMsg.agents
                persistDynamicCache()
                // 缓存 SDK 内置 skills/agents/commands 名单（与硬编码兜底列表合并，取并集）
                if (Array.isArray(sdkMsg.skills)) builtinCache.skills = [...new Set([...builtinCache.skills, ...sdkMsg.skills])]
                if (Array.isArray(sdkMsg.agents)) builtinCache.agents = [...new Set([...builtinCache.agents, ...sdkMsg.agents])]
                if (Array.isArray(sdkMsg.slash_commands)) builtinCache.commands = sdkMsg.slash_commands.map(n => typeof n === 'string' ? {
                    name: n,
                    description: '',
                    argumentHint: ''
                } : n)
                builtinCache.updatedAt = Date.now()
                void refreshContextUsage(sessionId, s, 'init')
            }
            // SDK 真正消费 user prompt 时才切换回合上下文。输入可能提前排队，不能在
            // WebSocket 到达时重置上一回合的文本和工具计数，否则镜像会串回合。
            if (sdkMsg.type === 'user') {
                const workflowResultId = taskWorkflowResultIdFromMessage(sdkMsg.message)
                const consumedWorkflowResult = consumeTaskWorkflowResultTurn(s._taskWorkflowGate, workflowResultId)
                const inputMeta = consumedWorkflowResult ? null : taskInputQueue.consume(s)
                const legacySource = consumedWorkflowResult ? null : s._pendingSources?.shift()
                s._internalWorkflowResultTurnId = consumedWorkflowResult ? workflowResultId : null
                s._generating = true
                s.activeTurnId = consumedWorkflowResult ? null : inputMeta?.turnId || null
                s.lastTurnSource = consumedWorkflowResult
                    ? s.taskCompletionIdentity?.source || s.lastTurnSource || 'desktop'
                    : inputMeta?.source || legacySource || s.lastTurnSource || 'desktop'
                s.activeTurnIdentity = consumedWorkflowResult && s.taskCompletionIdentity
                    ? {...s.taskCompletionIdentity}
                    : createTurnIdentity(s.lastTurnSource, inputMeta?.userId, IM_SOURCES)
                s.activeTaskDecision = consumedWorkflowResult
                    ? s.taskCompletionDecision || s.taskDecision || null
                    : inputMeta?.taskDecision || s.taskDecision || null
                s.turnText = ''
            }
            // 累积本轮文本（assistant 消息为权威完整版，用于 IM 镜像同步）
            // assistant 覆盖 text_delta 的增量累积，保证 mirror 拿到 SDK 提供的完整文本
            if (sdkMsg.type === 'assistant') {
                let completeText = ''
                for (const b of (sdkMsg.message?.content || [])) {
                    if (b.type === 'text' && b.text) completeText += b.text
                }
                if (completeText) {
                    s.turnText = completeText.slice(-100000)  // 上限 100KB，防长轮内存膨胀
                    // 检测 [WF:run 脚本名 {args}] 指令（仅当全局开关 enabled 时）
                    if (loadWfConfig().enabled) {
                        const wfMatch = s.turnText.match(/\[WF:run\s+([\w.-]+?)\s+(\{[\s\S]*?\})\]/);
                        if (wfMatch && !s._wfRan) {
                            const wfName = wfMatch[1];
                            let wfArgs = {};
                            try {
                                wfArgs = JSON.parse(wfMatch[2]);
                            } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
                            const valid = getWorkflow(wfName + '.mjs') || getWorkflow(wfName);
                            if (!valid) {
                                log.warn({sessionId: sessionId?.slice(0, 8), wfName}, '[WF:run] 脚本名无效，已忽略');
                            } else {
                                s._wfRan = true;
                                log.info({sessionId: sessionId?.slice(0, 8), wfName, wfArgs}, '[WF:run] 已触发');
                                runWfScript(wfName, sessionId, {
                                    ...wfArgs,
                                    _runKey: `${wfName}:${sessionId}`,
                                    _taskOwned: true,
                                    _taskId: s.coordinatorTaskId || s.taskCompletionTaskId,
                                    _taskDecision: s.taskDecision || null,
                                    _projectContext: s.projectContext || null,
                                }).catch(function (e) {
                                    log.error({err: e, sessionId: sessionId?.slice(0, 8), wfName}, 'Workflow 引擎错误');
                                });
                            }
                        }
                    }
                }
            }
            // result 只标志主 SDK 回合结束；父任务是否完成由 task-completion 协调器决定。
            if (sdkMsg.type === 'result') recordProviderUsage(sessionId, s, sdkMsg)
            if (sdkMsg.type === 'result' && s._internalWorkflowResultTurnId) {
                const workflowTurn = finishTaskWorkflowResultTurn(
                    s._taskWorkflowGate,
                    s._internalWorkflowResultTurnId,
                )
                s._internalWorkflowResultTurnId = null
                s._pendingCompletionEffects = []
                if (workflowTurn.deferredPrimaryResult) {
                    const transition = updateTaskCompletion(s, sessionId, workflowTurn.deferredPrimaryResult)
                    s._pendingCompletionEffects = transition.effects
                } else if (workflowTurn.consumed && !hasPendingTaskWorkflow(s._taskWorkflowGate)) {
                    log.warn({sessionId: sessionId?.slice(0, 8)}, '内部 Workflow 回合结束时没有可结算的父任务结果')
                }
                s.turnText = ''
                void refreshContextUsage(sessionId, s, 'workflow-result')
            } else if (sdkMsg.type === 'result') {
                const consumedInput = consumePendingSessionInputOnResult(s)
                if (consumedInput) {
                    log.debug({sessionId: sessionId?.slice(0, 8), turnId: consumedInput.turnId || null}, 'SDK 未回传 user 事件，已由 result 确认输入')
                }
                // 补充指令属于同一父任务。前一条输入结束后仍有排队输入时，
                // 必须等待最后一条 result，不能提前广播最终总结或启动最终审查。
                if (s._pendingInputs?.length) {
                    s.turnText = ''
                    s.autoContinuationTurns = 0
                    s._generating = false
                    void refreshContextUsage(sessionId, s, 'queued-input-result')
                    const wsMsg = sdkStreamAdapter.toClientEvent(sdkMsg, sessionId)
                    if (wsMsg) broadcastTurn(sessionId, {
                        ...wsMsg,
                        turnId: s.activeTurnId || null,
                        parentTaskTerminal: false,
                        taskState: taskStateForClient(s.taskState),
                    }, s.activeTurnIdentity)
                    s.activeTurnId = null
                    s.activeTurnIdentity = null
                    s.activeTaskDecision = null
                    broadcastTaskLifecycle(sessionId)
                    continue
                }
                let taskResult = classifyTaskResult({...sdkMsg, finalText: s.turnText})
                const completionDecision = s.activeTaskDecision || s.taskCompletionDecision || s.taskDecision || null
                const segmentTurns = Math.max(0, Math.trunc(Number(sdkMsg.num_turns) || 0))
                const totalTurns = Math.max(0, Number(s.autoContinuationTurns || 0)) + segmentTurns
                const decisionForContinuation = completionDecision || {}
                const executionMode = decisionForContinuation.executionMode || 'session'
                if (!s._taskRunBudget || s._taskRunBudget.mode !== executionMode) {
                    s._taskRunBudget = createTaskRunBudget(decisionForContinuation.continuationPolicy || {}, executionMode)
                    s._taskRunBudget.mode = executionMode
                }
                const continuation = resolveAutoContinuation({
                    result: taskResult,
                    decision: decisionForContinuation,
                    attempt: s.autoContinuationCount,
                    hasConversation: Boolean(s.lastSessionId || sdkMsg.session_id),
                    taskActive: ['running', 'fixing'].includes(s.taskCompletion?.phase),
                    budget: s._taskRunBudget,
                    progress: taskResult.progress === false ? false : null,
                    previousFingerprint: s._lastContinuationFingerprint,
                })
                if (continuation.shouldContinue) {
                    try {
                        maybeUpdateProjectCache(sessionId, s)
                    } catch (error) {
                        log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '自动续跑前更新 project-cache 失败')
                    }
                    try {
                        finalizeCheckpoint(sessionId)
                    } catch (error) {
                        log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '自动续跑前保存 checkpoint 失败')
                    }
                    s.autoContinuationCount = continuation.attempt
                    s._taskRunBudget = continuation.budget || s._taskRunBudget
                    s._lastContinuationFingerprint = taskResult.failureFingerprint || null
                    s.autoContinuationTurns = totalTurns
                    s.lastTaskResult = {
                        ...taskResult,
                        subtype: sdkMsg.subtype,
                        resumable: true,
                        result: `达到单段轮数上限，正在自动续跑（第 ${continuation.attempt}/${continuation.maxAttempts} 次）`,
                        rawResult: sdkMsg.result || sdkMsg.errors?.join('\n') || '',
                        numTurns: totalTurns,
                        at: Date.now(),
                    }
                    const continuationIdentity = s.activeTurnIdentity ? {...s.activeTurnIdentity} : s.taskCompletionIdentity || null
                    s._autoContinuationRequest = {
                        ...continuation,
                        taskDecision: completionDecision,
                        turnId: s.activeTurnId || s.taskCompletionTurnId || null,
                        source: continuationIdentity?.source || s.lastTurnSource || 'desktop',
                        userId: continuationIdentity?.userId || null,
                        identity: continuationIdentity,
                    }
                    taskInputQueue.prependInternal(s, {
                        turnId: s._autoContinuationRequest.turnId,
                        source: s._autoContinuationRequest.source,
                        userId: s._autoContinuationRequest.userId,
                        taskDecision: completionDecision,
                    })
                    beginTurn(sessionId, continuation.prompt, {
                        captureFiles: shouldCaptureTurnCheckpoint(completionDecision),
                    })
                    appendSessionEvent(s, 'task/auto-continuing', {
                        turnId: s._autoContinuationRequest.turnId,
                        attempt: continuation.attempt,
                        maxAttempts: continuation.maxAttempts,
                        tier: continuation.tier,
                        completedTurns: totalTurns,
                        executionMode: continuation.mode,
                        budget: {remaining: continuation.remaining || null},
                    })
                    updateTaskState(s, sessionId, {
                        ...s.taskState,
                        status: s.taskCompletion?.phase === 'fixing' ? 'fixing' : 'running',
                        outcome: null,
                        continuationReason: null,
                        resumable: true,
                        numTurns: totalTurns,
                        detail: `达到单段轮数上限，正在自动续跑（第 ${continuation.attempt}/${continuation.maxAttempts} 次）`,
                        completedAt: 0,
                        durationMs: 0,
                        execution: {
                            mode: continuation.mode,
                            continuationCount: continuation.attempt,
                            budget: {...s._taskRunBudget, remaining: continuation.remaining || null},
                        },
                    })
                    taskCompletionEventForClient(s, sessionId, 'task_auto_continuing', {
                        attempt: continuation.attempt,
                        maxAttempts: continuation.maxAttempts,
                        tier: continuation.tier,
                        completedTurns: totalTurns,
                    })
                    s.turnText = ''
                    s._generating = false
                    // 结束已达上限的 SDK 输入流，pump 收口后再用同一 session 重建下一段。
                    try { s.pushStream?.close() } catch (error) {
                        log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '自动续跑关闭旧输入流失败')
                    }
                    void refreshContextUsage(sessionId, s, 'max-turns')
                    continue
                }
                if (taskResult.outcome === 'incomplete' && taskResult.continuationReason === 'max_turns'
                    && ['session_mode', 'no_progress', 'max_rounds', 'max_tokens', 'max_duration', 'max_retries', 'max_message_hops', 'max_agents'].includes(continuation.reason)) {
                    taskResult = {...taskResult, continuationReason: continuation.reason, budget: s._taskRunBudget}
                    updateTaskState(s, sessionId, {
                        ...s.taskState,
                        status: 'incomplete', outcome: 'incomplete', continuationReason: continuation.reason,
                        resumable: true, execution: {mode: continuation.mode, continuationCount: s.autoContinuationCount, budget: s._taskRunBudget},
                    })
                    appendSessionEvent(s, 'task/continuation-paused', {reason: continuation.reason, executionMode: continuation.mode, budget: s._taskRunBudget})
                }
                s.lastTaskResult = {
                    ...taskResult,
                    subtype: sdkMsg.subtype,
                    resumable: canResumeTask(taskResult, Boolean(s.lastSessionId || sdkMsg.session_id)),
                    result: sdkMsg.result || sdkMsg.errors?.join('\n') || '',
                    numTurns: totalTurns,
                    at: Date.now(),
                }
                // maybeUpdateProjectCache 必须在 finalizeCheckpoint 之前调用：
                // finalizeCheckpoint 会清 s.pendingTurn，而 maybeUpdateProjectCache 依赖它拿 preSnapshot
                try {
                    maybeUpdateProjectCache(sessionId, s)
                } catch (e) {
                    log.warn({err: e, sessionId: sessionId?.slice(0, 8)}, 'project-cache 更新失败')
                }
                let checkpoint = null
                try {
                    checkpoint = finalizeCheckpoint(sessionId)
                } catch (e) {
                    log.warn({err: e, sessionId: sessionId?.slice(0, 8)}, 'finalizeCheckpoint 失败')
                }
                const fixing = s.taskCompletion?.phase === 'fixing'
                const workflowEnabled = loadWfConfig().enabled
                const reviewPlan = fixing && s.taskCompletion?.reviewPlan
                    ? s.taskCompletion.reviewPlan
                    : workflowEnabled
                        ? resolveFinalReviewPlan({decision: completionDecision, checkpoint})
                        : {required: false, tier: 'none', mode: 'none', riskDomains: []}
                if (checkpoint?.files?.length) {
                    const previous = fixing && Array.isArray(s.taskReviewFiles) ? s.taskReviewFiles : []
                    const byPath = new Map(previous.map(file => [file.path, file]))
                    for (const file of checkpoint.files) byPath.set(file.path, file)
                    s.taskReviewFiles = [...byPath.values()]
                    s.taskReviewCheckpointId = checkpoint.id
                }
                s.taskCompletionDecision = completionDecision
                s.taskCompletionIdentity = s.activeTurnIdentity ? {...s.activeTurnIdentity} : s.taskCompletionIdentity || null
                s.taskFinalReplyText = String(s.turnText || s.lastTaskResult.result || '').trim().slice(-100000)
                const currentTaskWorkbench = typeof getTaskWorkbench === 'function' ? getTaskWorkbench() : taskWorkbench
                if (s.coordinatorTaskId && currentTaskWorkbench) {
                    const primaryStatus = taskResult.outcome === 'succeeded'
                        ? 'completed'
                        : taskResult.outcome === 'incomplete' ? 'inconclusive' : 'failed'
                    currentTaskWorkbench.recordPrimaryResult(s.coordinatorTaskId, {
                        status: primaryStatus,
                        summary: s.lastTaskResult.result || taskResult.outcome,
                        changedFiles: (checkpoint?.files || []).map(file => file.path).filter(Boolean),
                        blockers: primaryStatus === 'completed' ? [] : [taskResult.continuationReason || sdkMsg.subtype || 'primary_execution_failed'],
                        nextAction: taskResult.continuationReason || '',
                    })
                    if (primaryStatus !== 'completed') currentTaskWorkbench.recordFailure(s.coordinatorTaskId, {
                        module: 'primary-session', phase: taskCoordinator.getTaskSnapshot(s.coordinatorTaskId)?.phase || 'implement',
                        errorCode: taskResult.continuationReason || sdkMsg.subtype || 'PRIMARY_EXECUTION_FAILED',
                        message: s.lastTaskResult.result || taskResult.outcome,
                        strategy: `primary-${s.taskCompletion?.fixAttempts || 0}`,
                        reproducible: taskResult.continuationReason !== 'environment_unavailable',
                        externalBlocker: taskResult.continuationReason === 'environment_unavailable',
                    })
                }
                const primaryResultEvent = {
                    type: 'primary_result',
                    result: {
                        ...taskResult,
                        detail: s.lastTaskResult.result,
                        text: s.taskFinalReplyText,
                    },
                    reviewPlan,
                }
                if (deferPrimaryResultForTaskWorkflow(s._taskWorkflowGate, primaryResultEvent)) {
                    s._pendingCompletionEffects = []
                } else {
                    takeDeferredPrimaryResult(s._taskWorkflowGate)
                    const transition = updateTaskCompletion(s, sessionId, primaryResultEvent)
                    s._pendingCompletionEffects = transition.effects
                }
                taskCompletionEventForClient(s, sessionId, 'primary_completed', {
                    primaryOutcome: taskResult.outcome,
                    detail: s.lastTaskResult.result || '',
                })
                s.turnText = ''
                s.autoContinuationTurns = 0
                void refreshContextUsage(sessionId, s, 'result')
            }
            if (sdkMsg.type === 'result') s._generating = false
            const clientSdkMsg = sdkMsg.type === 'result' && s.lastTaskResult?.numTurns
                ? {...sdkMsg, num_turns: s.lastTaskResult.numTurns}
                : sdkMsg
            const wsMsg = sdkStreamAdapter.toClientEvent(clientSdkMsg, sessionId)
            if (wsMsg) broadcastTurn(sessionId, {
                ...wsMsg,
                turnId: s.activeTurnId || null,
                parentTaskTerminal: sdkMsg.type === 'result' ? ['succeeded', 'failed', 'incomplete'].includes(s.taskCompletion?.phase) : undefined,
                taskState: sdkMsg.type === 'result' ? taskStateForClient(s.taskState) : undefined,
            }, s.activeTurnIdentity)
            if (sdkMsg.type === 'result') {
                const effects = Array.isArray(s._pendingCompletionEffects) ? s._pendingCompletionEffects.splice(0) : []
                void applyTaskCompletionEffects(sessionId, effects).catch(error => {
                    log.error({err: error, sessionId: sessionId?.slice(0, 8)}, '父任务完成副作用处理失败')
                })
                s.activeTurnId = null
                s.activeTurnIdentity = null
                s.activeTaskDecision = null
            }
            // text_delta 兜底累积到 turnText，防止后续轮次 SDK 不发 assistant 消息导致 mirror 丢文本
            if (wsMsg?.type === 'text_delta' && wsMsg.text) {
                s.turnText = ((s.turnText || '') + wsMsg.text).slice(-100000)
            }
            if (wsMsg?.type === 'tool_use_start') {
                try {
                    maybeInjectProjectCache(sessionId, s, wsMsg)
                } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
                try {
                    maybeInjectGitContext(sessionId, s)
                } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
            }
        }
    } catch (e) {
        log.error({err: e, sessionId: sessionId?.slice(0, 8)}, 'pump 异常')
        const failedSession = sessions.get(sessionId)
        const failedTurnIdentity = failedSession?.activeTurnIdentity ? {...failedSession.activeTurnIdentity} : null
        const watchdogTriggered = failedSession?._streamWatchdogTriggered === myQuery
        if (failedSession?.query === myQuery && !watchdogTriggered) {
            clearTaskWorkflowGate(failedSession._taskWorkflowGate)
            failedSession._internalWorkflowResultTurnId = null
            const transition = updateTaskCompletion(failedSession, sessionId, {
                type: 'runtime_failed',
                detail: String(e?.message || e || '任务执行异常中断'),
            })
            void applyTaskCompletionEffects(sessionId, transition.effects).catch(error => {
                log.error({err: error, sessionId: sessionId?.slice(0, 8)}, 'runtime 异常后的父任务失败通知处理失败')
            })
            failedSession._generating = false
            failedSession.activeTurnId = null
            failedSession.activeTurnIdentity = null
            failPendingSessionInputs(sessionId, failedSession, e)
            const completedAt = Date.now()
            failedSession.taskCompletedAt = completedAt
            const startedAt = Number(failedSession.taskStartedAt || failedSession.taskState?.startedAt || completedAt)
            updateTaskState(failedSession, sessionId, taskStateForError(e, {
                sdkSessionId: failedSession.lastSessionId,
                historySessionId: failedSession.lastSessionId,
                startedAt,
                completedAt,
                durationMs: Math.max(0, completedAt - startedAt),
            }))
            appendSessionEvent(failedSession, 'runtime/failed', {
                turnId: failedSession.taskState.turnId,
                code: typeof e?.code === 'string' ? e.code.slice(0, 120) : 'stream_error',
                durationMs: failedSession.taskState.durationMs,
            })
        }
        if (e.message !== 'cancelled' && !watchdogTriggered) broadcastTurn(sessionId, {
            type: 'error',
            message: e.message,
            code: 'stream_error',
            durationMs: failedSession?.taskState?.durationMs || 0,
            taskState: taskStateForClient(failedSession?.taskState),
        }, failedTurnIdentity)
        if (failedSession) broadcastTaskLifecycle(sessionId)
    } finally {
        const s2 = sessions.get(sessionId);
        if (s2?._streamWatchdogQuery === myQuery) clearStreamWatchdog(s2, myQuery)
        if (s2?._streamWatchdogTriggered === myQuery) s2._streamWatchdogTriggered = null
        const autoContinuationRequest = s2?.query === myQuery ? s2._autoContinuationRequest : null
        // 仅当 query 未被重建替换时才置空，避免覆盖新 pump 持有的 query
        if (s2 && s2.query === myQuery) {
            s2._generating = false
            s2.query = null
            if (autoContinuationRequest) {
                try { s2.pushStream?.close() } catch (error) {
                    log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '关闭已达轮数上限的输入流失败')
                }
                s2.pushStream = null
            }
        }
        if (s2 && s2.query === null && !autoContinuationRequest && s2._onPumpDone) {
            const onPumpDone = s2._onPumpDone
            s2._onPumpDone = null
            try { onPumpDone() } catch (e) {
                log.warn({err: e, sessionId: sessionId?.slice(0, 8)}, '定时任务清理回调失败')
            }
        }
        // 定时任务临时 session (无固定 sessionId) 完成后自动清理，防止累积
        if (s2?._autoDelete && !autoContinuationRequest && !s2.clients?.size) {
            markSessionDeleted(sessionId)
            finishImProgressReporters(sessionId)
            sessions.delete(sessionId)
            clearAdapterBindingsForSessions(sessionId, s2.lastSessionId)
            if (getFocusedSessionId?.() === sessionId) setFocusedSessionId?.(null)
            invalidateProjectsCache()
            deleteSessionFiles(sessionId, [s2.lastSessionId]).catch(error => {
                log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '清理临时 Session 文件失败')
            })
        }
        if (autoContinuationRequest && sessions.get(sessionId) === s2) {
            // 立即建立 rebuildPromise，避免用户追加消息与自动续跑各自启动一个 query。
            void startAutoContinuation(sessionId, s2, autoContinuationRequest)
        }
    }
}


    return {startStreamPump, startAutoContinuation}
}
