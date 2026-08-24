/** Session 输入队列和 SDK 流超时端口。 */
export function createSessionInputRuntime({
    taskInputQueue,
    createTurnIdentity,
    selectCancelledTurnInputs,
    broadcastTurn,
    getBroadcastTurn = () => broadcastTurn,
    sessions,
    sessionCoordinator,
    streamIdleTimeoutMs,
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
        if (session._streamWatchdogTimer) clearTimeout(session._streamWatchdogTimer)
        if (session._streamWatchdogCleanup) void session._streamWatchdogCleanup()
        session._streamWatchdogCleanup = null
        session._streamWatchdogTimer = null
        session._streamWatchdogQuery = null
        sessionCoordinator.clearTimeout(session, query)
    }

    function armStreamWatchdog(sessionId, session, query) {
        if (!session || !query || session.query !== query || streamIdleTimeoutMs <= 0) return
        clearStreamWatchdog(session)
        session._streamWatchdogQuery = query
        sessionCoordinator.beginTimeout(session, query, 'stream_idle_timeout')
        session._streamWatchdogTimer = setTimeout(() => {
            const hasActiveWork = Boolean(session._generating || session.activeTurnId || session._rebuildPromise || session._pendingInputs?.length)
            if (sessions.get(sessionId) !== session || session.query !== query || !hasActiveWork || !sessionCoordinator.isTimeoutCurrent(session, query)) return
            session._streamWatchdogTriggered = query
            const detail = `API 超过 ${Math.round(streamIdleTimeoutMs / 1000)} 秒未返回新事件，已自动中断当前执行；已有修改和会话上下文已保留，可继续执行。`
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
            Promise.resolve(query.return?.()).catch(error => logger.warn({err: error, sessionId: sessionId?.slice(0, 8)}, 'SDK 流超时关闭失败'))
        }, streamIdleTimeoutMs)
        session._streamWatchdogCleanup = session.cleanupRegistry?.register?.('timer', () => {
            if (session._streamWatchdogTimer) clearTimeout(session._streamWatchdogTimer)
            session._streamWatchdogTimer = null
        }, 'stream-idle-watchdog') || null
        session._streamWatchdogTimer.unref?.()
    }

    return {acceptSessionInput, rollbackSessionInput, failPendingSessionInputs, cancelPendingSessionInputs, clearStreamWatchdog, armStreamWatchdog}
}
