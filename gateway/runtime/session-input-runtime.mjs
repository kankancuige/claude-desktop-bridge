/** Session 输入队列和 SDK 流超时端口。 */
export function createSessionInputRuntime({
    taskInputQueue,
    createTurnIdentity,
    selectCancelledTurnInputs,
    broadcastTurn,
    getBroadcastTurn = () => broadcastTurn,
    sessions,
    sessionCoordinator,
    streamIdleTimeoutMs = 10 * 60 * 1000,
    streamToolIdleTimeoutMs = streamIdleTimeoutMs,
    streamMaxDurationMs = 2 * 60 * 60 * 1000,
    streamHeartbeatIntervalMs = 0,
    getStreamTimeoutConfig = null,
    updateTaskCompletion,
    applyTaskCompletionEffects,
    taskStateForError,
    updateTaskState,
    appendSessionEvent,
    taskStateForClient,
    getTaskStateForClient = () => taskStateForClient,
    broadcastTaskLifecycle,
    logger = {debug() {}, error() {}, warn() {}},
    imSources = [],
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    now = () => Date.now(),
} = {}) {
    if (!taskInputQueue || typeof createTurnIdentity !== 'function' || typeof selectCancelledTurnInputs !== 'function'
        || typeof getBroadcastTurn !== 'function' || !sessions || !sessionCoordinator
        || typeof updateTaskCompletion !== 'function' || typeof applyTaskCompletionEffects !== 'function'
        || typeof taskStateForError !== 'function' || typeof updateTaskState !== 'function'
        || typeof appendSessionEvent !== 'function' || typeof getTaskStateForClient !== 'function'
        || typeof broadcastTaskLifecycle !== 'function') {
        throw new TypeError('session input dependencies are required')
    }

    function acceptSessionInput(session, source, messageId, userId = null, taskDecision = null) {
        return taskInputQueue.accept(session, {source, messageId, userId, taskDecision})
    }

    function rollbackSessionInput(session, accepted) {
        return taskInputQueue.rollback(session, accepted)
    }

    function failPendingSessionInputs(sessionId, session, error) {
        const pending = taskInputQueue.drain(session)
        session._pendingSources = []
        for (const input of pending) {
            const identity = createTurnIdentity(input.source, input.userId, imSources)
            getBroadcastTurn()(sessionId, {type: 'error', code: error?.code || 'session_input_failed', message: String(error?.message || error || '消息处理失败'), turnId: input.turnId || null}, identity)
        }
        return pending.length
    }

    function cancelPendingSessionInputs(sessionId, session, activeTurnId = null) {
        const pending = taskInputQueue.drain(session)
        session._pendingSources = []
        for (const input of selectCancelledTurnInputs(pending, activeTurnId)) {
            const identity = createTurnIdentity(input.source, input.userId, imSources)
            getBroadcastTurn()(sessionId, {type: 'generation_stopped', turnId: input.turnId || null}, identity)
        }
        return pending.length
    }

    function clearStreamWatchdog(session, query = null) {
        if (!session) return
        if (query && session._streamWatchdogQuery && session._streamWatchdogQuery !== query) return
        if (session._streamWatchdogTimer) clearTimer(session._streamWatchdogTimer)
        if (session._streamHeartbeatTimer) clearTimer(session._streamHeartbeatTimer)
        if (session._streamWatchdogCleanup) void session._streamWatchdogCleanup()
        session._streamWatchdogCleanup = null
        session._streamWatchdogTimer = null
        session._streamHeartbeatTimer = null
        session._streamWatchdogQuery = null
        sessionCoordinator.clearTimeout(session, query)
    }

    function hasActiveStreamWork(session) {
        if (!session) return false
        return Boolean(session._generating || session.activeTurnId || session._rebuildPromise || session._pendingInputs?.length)
    }

    function armStreamWatchdog(sessionId, session, query) {
        if (!session || !query || session.query !== query || streamIdleTimeoutMs <= 0) return
        // 长连接 query 在等待用户首条消息时也会存在，不能把它当成正在执行的回合。
        if (!hasActiveStreamWork(session)) {
            clearStreamWatchdog(session, query)
            return
        }
        clearStreamWatchdog(session)
        session._streamWatchdogQuery = query
        if (!Number(session._streamWatchdogStartedAt)) session._streamWatchdogStartedAt = now()
        sessionCoordinator.beginTimeout(session, query, 'stream_idle_timeout')
        const schedule = () => {
            const configured = typeof getStreamTimeoutConfig === 'function' ? getStreamTimeoutConfig() : null
            const idleTimeout = Number(configured?.idleTimeoutMs) > 0 ? configured.idleTimeoutMs : streamIdleTimeoutMs
            const toolIdleTimeout = Number(configured?.toolIdleTimeoutMs) > 0 ? configured.toolIdleTimeoutMs : streamToolIdleTimeoutMs
            const maxDuration = Number(configured?.maxDurationMs) > 0 ? configured.maxDurationMs : streamMaxDurationMs
            const startedAt = Number(session.taskStartedAt || session._streamWatchdogStartedAt || now())
            const elapsedMs = Math.max(0, now() - startedAt)
            const hasPendingConfirmation = session.pending?.size > 0
            const hasActiveTool = Boolean(session._activeTools?.size)
            const idleWindowMs = hasPendingConfirmation
                ? Math.min(idleTimeout, 5 * 60 * 1000)
                : hasActiveTool ? toolIdleTimeout : idleTimeout
            const remainingMs = Math.max(0, maxDuration - elapsedMs)
            session._streamWatchdogTimer = setTimer(() => {
                if (sessions.get(sessionId) !== session || session.query !== query || !hasActiveStreamWork(session) || !sessionCoordinator.isTimeoutCurrent(session, query)) {
                    session._streamWatchdogTimer = null
                    return
                }
                const currentStartedAt = Number(session.taskStartedAt || session._streamWatchdogStartedAt || now())
                const currentElapsedMs = Math.max(0, now() - currentStartedAt)
                if (currentElapsedMs < maxDuration) {
                    // 重新读取状态：工具可能在本次计时期间开始、推进或结束。
                    if (session.pending?.size > 0) {
                        schedule()
                        return
                    }
                    if (session._activeTools?.size > 0) {
                        schedule()
                        return
                    }
                }
                session._streamWatchdogTriggered = query
                if (typeof session._finishModelUsage === 'function') void session._finishModelUsage('failed', 'stream_idle_timeout')
                if (session._streamHeartbeatTimer) clearTimer(session._streamHeartbeatTimer)
                session._streamHeartbeatTimer = null
                const reason = currentElapsedMs >= maxDuration ? '达到任务绝对时限' : '超过动态空闲时限未返回新事件'
                const detail = `API ${reason}，已自动中断当前执行；已有修改和会话上下文已保留，可继续执行。`
                session.diagnostics?.record?.({phase: 'timeout', errorCode: 'stream_idle_timeout', durationMs: Math.max(0, Date.now() - Number(session.taskStartedAt || Date.now()))})
                const timeoutIdentity = session.activeTurnIdentity ? {...session.activeTurnIdentity} : null
                logger.error({sessionId: sessionId?.slice(0, 8), timeoutMs: streamIdleTimeoutMs}, 'SDK 流长时间无事件，自动收口')
                const transition = updateTaskCompletion(session, sessionId, {type: 'runtime_failed', detail})
                void applyTaskCompletionEffects(sessionId, transition.effects).catch(error => logger.error({err: error, sessionId: sessionId?.slice(0, 8)}, 'SDK 流超时后的任务收口失败'))
                session._generating = false
                session.activeTurnId = null
                session.activeTurnIdentity = null
                failPendingSessionInputs(sessionId, session, new Error(detail))
                const completedAt = Date.now()
                session.taskCompletedAt = completedAt
                const startedAt = Number(session.taskStartedAt || session.taskState?.startedAt || completedAt)
                updateTaskState(session, sessionId, taskStateForError(new Error(detail), {sdkSessionId: session.lastSessionId, historySessionId: session.lastSessionId, startedAt, completedAt, durationMs: Math.max(0, completedAt - startedAt)}))
                appendSessionEvent(session, 'runtime/failed', {turnId: session.taskState.turnId, code: 'stream_idle_timeout', durationMs: session.taskState.durationMs})
                getBroadcastTurn()(sessionId, {type: 'error', code: 'stream_idle_timeout', message: detail, durationMs: session.taskState.durationMs, taskState: getTaskStateForClient()(session.taskState)}, timeoutIdentity)
                broadcastTaskLifecycle(sessionId)
                if (session.query === query) session.query = null
                try { session.pushStream?.close() } catch (error) { logger.debug({err: error, sessionId: sessionId?.slice(0, 8)}, 'SDK 流超时输入流关闭失败') }
                session.pushStream = null
                try {
                    if (typeof query.close === 'function') query.close()
                    else Promise.resolve(query.return?.()).catch(error => logger.warn({err: error, sessionId: sessionId?.slice(0, 8)}, 'SDK 流超时关闭失败'))
                } catch (error) {
                    logger.warn({err: error, sessionId: sessionId?.slice(0, 8)}, 'SDK 流超时关闭失败')
                } finally {
                    const controller = session.queryOpts?.abortController
                    if (controller && !controller.signal.aborted) controller.abort('stream_idle_timeout')
                }
            }, Math.min(idleWindowMs, remainingMs))
            session._streamWatchdogTimer.unref?.()
        }
        schedule()
        if (streamHeartbeatIntervalMs > 0) {
            const heartbeat = () => {
                if (sessions.get(sessionId) !== session || session.query !== query
                    || !sessionCoordinator.isTimeoutCurrent(session, query)) return
                if (!hasActiveStreamWork(session)) {
                    clearStreamWatchdog(session, query)
                    return
                }
                const waitingFor = session.pending?.size > 0 ? 'permission'
                    : session._activeTools?.size > 0 ? 'tool' : 'provider'
                const elapsedMs = Math.max(0, now() - Number(session.taskStartedAt || session._streamWatchdogStartedAt || now()))
                getBroadcastTurn()(sessionId, {
                    type: 'stream_waiting',
                    waitingFor,
                    elapsedMs,
                    message: waitingFor === 'permission' ? '等待工具权限确认'
                        : waitingFor === 'tool' ? '工具仍在执行，等待返回进度'
                            : '正在等待 Provider 返回首个事件',
                    taskState: getTaskStateForClient()(session.taskState),
                }, session.activeTurnIdentity ? {...session.activeTurnIdentity} : null)
                session._streamHeartbeatTimer = setTimer(heartbeat, streamHeartbeatIntervalMs)
                session._streamHeartbeatTimer.unref?.()
            }
            session._streamHeartbeatTimer = setTimer(heartbeat, streamHeartbeatIntervalMs)
            session._streamHeartbeatTimer.unref?.()
        }
        session._streamWatchdogCleanup = session.cleanupRegistry?.register?.('timer', () => {
            if (session._streamWatchdogTimer) clearTimer(session._streamWatchdogTimer)
            if (session._streamHeartbeatTimer) clearTimer(session._streamHeartbeatTimer)
            session._streamWatchdogTimer = null
            session._streamHeartbeatTimer = null
            session._streamWatchdogStartedAt = 0
        }, 'stream-idle-watchdog') || null
    }

    return {acceptSessionInput, rollbackSessionInput, failPendingSessionInputs, cancelPendingSessionInputs, clearStreamWatchdog, armStreamWatchdog}
}
