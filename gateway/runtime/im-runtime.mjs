/**
 * IM Runtime：适配器生命周期、通知投影、阶段进度和跨平台镜像。
 * 通过端口访问 Session、Task 和 Storage，不直接依赖 WebSocket 或 HTTP。
 */
export function createImRuntime(deps = {}) {
    const {
        sessions, IM_SOURCES, ADAPTER_TOKENS, ADAPTER_STARTERS, taskCommands,
        getNotificationRepository, updateTaskNotificationState, loadTaskState,
        buildIncompleteMirrorText, shouldRouteMirror, getSessionRepository, getImRepository,
        clearAdapterBindings, BRIDGE_HOME, join, existsSync, unlinkSync,
        log, createImProgressPolicy, createImProgressReporter, taskStateForClient,
        onNotificationStateChange,
    } = deps
    if (!sessions || !IM_SOURCES || !ADAPTER_STARTERS) throw new TypeError('IM runtime dependencies are required')
    const notificationRepository = () => getNotificationRepository?.() || null
    const confirmHooks = []
    const imProgressReporters = new Map()
    const imProgressPolicy = createImProgressPolicy()

function getAdapterHook(platform) {
    return confirmHooks.find(hook => hook.platform === platform) || null
}

function notificationTaskId(notificationId) {
    const match = String(notificationId || '').match(/^(.*):(task_completed|task_failed|task_review_paused|task_verification_inconclusive)$/)
    return match?.[1] || ''
}

function handleNotificationStateChange({platform, notificationId, state, lastError = ''} = {}) {
    const taskId = notificationTaskId(notificationId)
    if (!platform || !taskId) return false
    const updatedAt = Date.now()
    for (const [sessionId, session] of sessions) {
        if (session?.taskCompletionTaskId !== taskId && session?.taskState?.taskId !== taskId) continue
        updateTaskNotificationState(session, sessionId, platform, state, notificationId, lastError)
        return true
    }
    try {
        return notificationRepository()?.updateState?.({
            taskId, platform, notificationId, state, lastError, updatedAt,
        }) === true
    } catch (error) {
        log.warn({err: error, platform, notificationId}, '通知状态回写 PostgreSQL 任务投影失败')
        return false
    }
}

async function reconcilePersistedNotificationIntents(platform) {
    const hook = getAdapterHook(platform)
    const repository = notificationRepository()
    if (!hook || !repository) return 0
    let restored = 0
    for (const task of repository.listPending({platform, limit: 200})) {
        const intent = task.notifications?.[platform]
        if (!intent?.notificationId || hook.notificationState?.(intent.notificationId)) continue
        const catalog = [task.sdkSessionId, task.sessionId]
            .filter(Boolean)
            .map(id => getSessionRepository?.()?.get?.({projectKey: task.projectKey, sessionId: id}))
            .find(Boolean)
        if (!catalog?.workDir || !task.sessionId) continue
        const persisted = loadTaskState(catalog.workDir, task.sdkSessionId || task.sessionId)
            || loadTaskState(catalog.workDir, task.sessionId)
        const text = buildIncompleteMirrorText(persisted?.finalReplyText || persisted?.detail, {
            outcome: task.status === 'succeeded' ? 'succeeded'
                : ['incomplete', 'review_paused'].includes(task.status) ? 'incomplete' : 'failed',
            continuationReason: task.continuationReason || null,
        })
        if (!text) continue
        try {
            const result = await hook.sendToUser(task.sessionId, text, null, intent.notificationId)
            const next = result === true || result?.sent === true
                ? {state: 'sent', lastError: ''}
                : result?.queued === true
                    ? {state: 'pending', lastError: result.error || 'queued_for_retry'}
                    : {state: 'failed', lastError: result?.error || 'send_failed'}
            handleNotificationStateChange({platform, notificationId: intent.notificationId, ...next})
            restored++
        } catch (error) {
            handleNotificationStateChange({
                platform, notificationId: intent.notificationId,
                state: 'failed', lastError: error?.message || error,
            })
            log.warn({err: error, platform, taskId: task.taskId}, '持久化任务通知意图恢复失败')
        }
    }
    return restored
}

function imProgressReporterKey(sessionId, turnId, platform, userId) {
    return [sessionId, turnId || 'turn', platform, userId || 'bound-user'].join(':')
}

function imProgressRecipients(sessionId, identity = null) {
    const session = sessions.get(sessionId)
    if (!session) return []
    const turnIdentity = identity || session.activeTurnIdentity || session.taskCompletionIdentity || null
    if (['wechat', 'feishu', 'dingtalk'].includes(turnIdentity?.source)) {
        const hook = getAdapterHook(turnIdentity.source)
        return hook ? [{hook, userId: turnIdentity.userId || null, mirrored: false}] : []
    }
    return confirmHooks
        .filter(hook => session.mirrors?.[hook.platform] && shouldRouteMirror(hook.platform, turnIdentity))
        .map(hook => ({hook, userId: turnIdentity?.userId || null, mirrored: true}))
}

function finishImProgressReporters(sessionId, turnId = null) {
    const prefix = `${sessionId}:`
    for (const [key, reporter] of imProgressReporters) {
        if (!key.startsWith(prefix) || (turnId && !key.startsWith(`${sessionId}:${turnId}:`))) continue
        reporter.finish()
        imProgressReporters.delete(key)
    }
}

function reportImProgressEvent(sessionId, event, identity = null) {
    const session = sessions.get(sessionId)
    if (!session || !event || typeof event !== 'object') return
    const turnId = event.turnId || session.taskCompletionTurnId || session.activeTurnId || 'turn'
    if (['task_completed', 'task_failed', 'task_review_paused', 'task_verification_inconclusive', 'generation_stopped', 'stream_error', 'error'].includes(event.type)) {
        finishImProgressReporters(sessionId, turnId)
        return
    }
    const policy = imProgressPolicy.evaluate(event, Date.now())
    if (!policy.send) return
    for (const {hook, userId, mirrored} of imProgressRecipients(sessionId, identity)) {
        const key = imProgressReporterKey(sessionId, turnId, hook.platform, userId)
        let reporter = imProgressReporters.get(key)
        if (!reporter) {
            reporter = createImProgressReporter({
                send: async text => {
                    const currentSession = sessions.get(sessionId)
                    const currentHook = getAdapterHook(hook.platform)
                    if (!currentSession || !currentHook) return
                    if (mirrored && !currentSession.mirrors?.[hook.platform]) return
                    await currentHook.sendToUser(sessionId, text, userId)
                },
                firstDelayMs: 0,
                intervalMs: 0,
                onError: error => log.warn({err: error, platform: hook.platform, sessionId: sessionId.slice(0, 8)}, 'IM 阶段进度发送失败'),
            })
            imProgressReporters.set(key, reporter)
        }
        reporter.observe({...event, startedAt: event.startedAt || session.taskStartedAt || 0})
    }
}

function taskStateForSessionClient(session) {
    if (!session?.taskState) return taskStateForClient(session?.taskState)
    const notifications = {...(session.taskState.notifications || {})}
    for (const [platform, current] of Object.entries(notifications)) {
        const live = getAdapterHook(platform)?.notificationState?.(current.notificationId)
        if (!live?.state || live.state === current.state && !live.lastError) continue
        notifications[platform] = {...current, state: live.state, lastError: live.lastError || '', updatedAt: Date.now()}
    }
    return taskStateForClient({...session.taskState, notifications})
}

function stopAdapter(platform) {
    const index = confirmHooks.findIndex(hook => hook.platform === platform)
    if (index < 0) return false
    const [hook] = confirmHooks.splice(index, 1)
    try {
        hook.stop?.()
    } catch (error) {
        log.warn({err: error, platform}, '停止 IM 适配器失败')
    }
    return true
}

function startAdapter(platform) {
    if (getAdapterHook(platform)) return getAdapterHook(platform)
    const starter = ADAPTER_STARTERS.get(platform)
    if (!starter) return null
    try {
        const hooks = starter(ADAPTER_TOKENS.get(platform), {
            taskCommands,
            repository: getImRepository?.(),
            onNotificationStateChange: handleNotificationStateChange,
        })
        if (!hooks) return null
        const registered = {...hooks, platform}
        confirmHooks.push(registered)
        for (const [sessionId, session] of sessions) {
            if (session?.taskState?.notifications?.[platform]?.state === 'pending') {
                queueMicrotask(() => reconcileTaskNotificationIntents(sessionId, session, platform))
            }
        }
        queueMicrotask(() => reconcilePersistedNotificationIntents(platform).catch(error => {
            log.warn({err: error, platform}, '适配器启动后恢复待通知任务失败')
        }))
        return registered
    } catch (error) {
        log.error({err: error, platform}, '启动 IM 适配器失败')
        return null
    }
}

function restartAdapter(platform) {
    stopAdapter(platform)
    return startAdapter(platform)
}

function clearAdapterPlatformState(platform) {
    stopAdapter(platform)
    const bindings = clearAdapterBindings(binding => binding.platform === platform)
    const cleared = notificationRepository()?.clearPlatform?.(platform) || {inbox: 0, notifications: 0}
    const postgresInbox = cleared.inbox || 0
    const postgresNotifications = cleared.notifications || 0
    const inbox = postgresInbox
    const notifications = postgresNotifications
    const pairedFiles = {
        wechat: 'bridge-paired.json',
        feishu: 'bridge-paired-feishu.json',
        dingtalk: 'bridge-paired-dingtalk.json',
    }
    let paired = false
    const pairedFile = pairedFiles[platform] ? join(BRIDGE_HOME, pairedFiles[platform]) : null
    if (pairedFile && existsSync(pairedFile)) {
        try {
            unlinkSync(pairedFile)
            paired = true
        } catch (error) {
            log.warn({err: error, platform}, '清理 IM 配对白名单失败')
        }
    }
    return {bindings, inbox, notifications, paired, postgres: {inbox: postgresInbox, notifications: postgresNotifications}}
}

// ── 多平台镜像同步（maybeMirror）──
// 功能说明: 每个回合结束后，将本轮累积的 Claude 回复文本推送到所有开启 mirror 的 IM 平台
//   遍历 confirmHooks，仅对 session.mirrors[hook.platform]===true 的适配器调用 sendToUser
// 实现方式: 取 s.turnText 文本，trim 后非空则逐适配器 hook.sendToUser(sid, text)；各适配器负责自己的格式化/发送逻辑
// 关键数据流: s.turnText（startStreamPump 中累积）→ 遍历 confirmHooks
//   → check s.mirrors[hook.platform] → hook.sendToUser(sid, text) → IM 平台
async function maybeMirror(sid, taskResult = {outcome: 'succeeded'}, notificationId = null) {
    const s = sessions.get(sid)
    if (!s) return {attempted: 0, sent: 0, pending: 0, failed: 0}
    const text = buildIncompleteMirrorText(s.turnText || s.taskFinalReplyText || s.taskState?.detail, taskResult)
    if (!text) return {attempted: 0, sent: 0, pending: 0, failed: 0}
    const turnIdentity = s.activeTurnIdentity ? {...s.activeTurnIdentity} : null
    const summary = {attempted: 0, sent: 0, pending: 0, failed: 0}
    for (const hook of confirmHooks) {
        if (!s.mirrors[hook.platform]) continue
        if (!shouldRouteMirror(hook.platform, turnIdentity)) continue
        summary.attempted++
        try {
            const result = await hook.sendToUser(sid, text, turnIdentity?.userId || null, notificationId)
            if (result === true || result?.sent === true) {
                summary.sent++
                updateTaskNotificationState(s, sid, hook.platform, 'sent', notificationId)
            } else if (result?.queued === true) {
                summary.pending++
                updateTaskNotificationState(s, sid, hook.platform, 'pending', notificationId, result.error || 'queued_for_retry')
            } else {
                summary.failed++
                updateTaskNotificationState(s, sid, hook.platform, 'failed', notificationId, result?.error || 'send_failed')
            }
        } catch (e) {
            summary.failed++
            updateTaskNotificationState(s, sid, hook.platform, 'failed', notificationId, e?.message || e)
            log.warn({err: e, platform: hook.platform, sessionId: sid?.slice(0, 8)}, 'mirror sendToUser 失败')
        }
    }
    return summary
}

async function reconcileTaskNotificationIntents(sessionId, session = sessions.get(sessionId), platform = null) {
    if (!session?.taskState || !['succeeded', 'failed', 'incomplete', 'review_paused', 'interrupted'].includes(session.taskState.status)) return false
    const pending = Object.entries(session.taskState.notifications || {}).filter(([name, item]) =>
        (!platform || name === platform) && ['pending', 'failed'].includes(item?.state))
    if (!pending.length) return false
    const missing = pending.some(([name, item]) => {
        const hook = getAdapterHook(name)
        return hook && !hook.notificationState?.(item.notificationId)
    })
    if (!missing) return false
    const outcome = session.taskState.status === 'succeeded'
        ? 'succeeded'
        : session.taskState.status === 'incomplete' || session.taskState.status === 'review_paused' ? 'incomplete' : 'failed'
    const notificationId = pending[0][1]?.notificationId
        || `${session.taskState.taskId || sessionId}:${outcome === 'succeeded' ? 'task_completed' : outcome === 'incomplete' ? 'task_review_paused' : 'task_failed'}`
    try {
        await maybeMirror(sessionId, {outcome, continuationReason: outcome === 'succeeded' ? null : 'execution_error'}, notificationId)
        return true
    } catch (error) {
        log.warn({err: error, sessionId: String(sessionId).slice(0, 8)}, '恢复缺失的任务通知意图失败')
        return false
    }
}


    return {
        confirmHooks, imProgressReporters, ADAPTER_STARTERS,
        getAdapterHook, handleNotificationStateChange,
        reconcilePersistedNotificationIntents, imProgressRecipients,
        finishImProgressReporters, reportImProgressEvent,
        taskStateForSessionClient, stopAdapter, startAdapter, restartAdapter,
        clearAdapterPlatformState, maybeMirror, reconcileTaskNotificationIntents,
    }
}
