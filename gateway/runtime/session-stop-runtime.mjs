/** Session 停止、取消和资源收口端口。 */
export function createSessionStopRuntime({
    sessions,
    getSessionWorkflowStates,
    hasStoppableSessionWork,
    clearStreamWatchdog,
    getSessionStopScope,
    stopWorkflow,
    broadcastTaskLifecycle,
    resolvePrimaryStopTurnId,
    updateTaskCompletion,
    getTaskWorkbench,
    clearTaskWorkflowGate,
    sessionCoordinator,
    settlePending,
    closeSessionRuntime,
    finalizeCheckpoint,
    cancelPendingSessionInputs,
    taskStateForStop,
    updateTaskState,
    appendSessionEvent,
    broadcastTurn,
    getBroadcastTurn = () => broadcastTurn,
    taskStateForClient,
    getTaskStateForClient = () => taskStateForClient,
    logger = {debug() {}, warn() {}},
} = {}) {
    if (!sessions || typeof getSessionWorkflowStates !== 'function' || typeof hasStoppableSessionWork !== 'function'
        || typeof clearStreamWatchdog !== 'function' || typeof getSessionStopScope !== 'function'
        || typeof stopWorkflow !== 'function' || typeof broadcastTaskLifecycle !== 'function'
        || typeof resolvePrimaryStopTurnId !== 'function' || typeof updateTaskCompletion !== 'function'
        || typeof getTaskWorkbench !== 'function' || typeof clearTaskWorkflowGate !== 'function'
        || !sessionCoordinator || typeof settlePending !== 'function' || typeof closeSessionRuntime !== 'function'
        || typeof finalizeCheckpoint !== 'function' || typeof cancelPendingSessionInputs !== 'function'
        || typeof taskStateForStop !== 'function' || typeof updateTaskState !== 'function'
        || typeof appendSessionEvent !== 'function' || typeof getBroadcastTurn !== 'function'
        || typeof getTaskStateForClient !== 'function') {
        throw new TypeError('session stop dependencies are required')
    }

    async function stopSessionGeneration(sessionId, session) {
        if (!session) return {stopped: false, cancelledInputs: 0}
        if (session._stopPromise) return session._stopPromise
        let workflowStates = []
        try {
            workflowStates = getSessionWorkflowStates(sessionId)
        } catch (error) {
            logger.debug({err: error, sessionId: sessionId?.slice(0, 8)}, '读取 Workflow 停止状态失败')
        }
        if (!hasStoppableSessionWork(session, workflowStates)) return {stopped: false, cancelledInputs: 0}
        const operation = (async () => {
            clearStreamWatchdog(session)
            const stopScope = getSessionStopScope(session, workflowStates)
            for (const workflow of stopScope.activeWorkflows) {
                if (workflow.wfId || workflow.name) stopWorkflow(workflow.wfId || workflow.name)
            }
            if (!stopScope.primaryActive) {
                // Workflow-only 停止也必须收口本地 Gate、输入队列和运行时资源；
                // 否则 taskWorkflowPending 会继续把已经停止的会话判定为 active。
                clearTaskWorkflowGate(session._taskWorkflowGate)
                session._internalWorkflowResultTurnId = null
                session._autoContinuationRequest = null
                session.autoContinuationCount = 0
                session.autoContinuationTurns = 0
                sessionCoordinator.cancel(session, 'stop_generation')
                for (const id of [...(session.pending?.keys() || [])]) {
                    settlePending(sessionId, id, {behavior: 'deny', message: '已取消', interrupt: true}, 'stopped')
                }
                await closeSessionRuntime(session, {sessionId, reason: 'stop_workflow'})
                session.query = null
                session.pushStream = null
                session.pendingTurn = null
                const cancelledInputs = cancelPendingSessionInputs(sessionId, session, null)
                session._pendingTurns = []
                session._generating = false
                session.activeTurnId = null
                session.activeTurnIdentity = null
                broadcastTaskLifecycle(sessionId)
                return {stopped: true, scope: 'workflow', cancelledInputs, turnId: null}
            }
            const stoppedTurnId = resolvePrimaryStopTurnId(session)
            const stoppedTurnIdentity = session.activeTurnIdentity ? {...session.activeTurnIdentity} : null
            if (typeof session._finishModelUsage === 'function') await session._finishModelUsage('cancelled', 'stop_generation')
            updateTaskCompletion(session, sessionId, {type: 'user_stopped', detail: '用户已暂停任务'})
            const taskWorkbench = getTaskWorkbench()
            if (session.coordinatorTaskId && taskWorkbench) taskWorkbench.recordTaskEvent(session.coordinatorTaskId, {type: 'task/paused', detail: '用户已暂停任务'})
            clearTaskWorkflowGate(session._taskWorkflowGate)
            session._internalWorkflowResultTurnId = null
            session._autoContinuationRequest = null
            session.autoContinuationCount = 0
            session.autoContinuationTurns = 0
            sessionCoordinator.cancel(session, 'stop_generation')
            session.diagnostics?.record?.({phase: 'cancel', cleanupOutcome: 'requested', errorCode: 'stop_generation'})
            for (const id of [...(session.pending?.keys() || [])]) settlePending(sessionId, id, {behavior: 'deny', message: '已取消', interrupt: true}, 'stopped')
            await closeSessionRuntime(session, {sessionId, reason: 'stop_generation'})
            session.query = null
            session.pushStream = null
            try { finalizeCheckpoint(sessionId) } catch (error) { logger.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '停止生成时保存 checkpoint 失败') }
            session.pendingTurn = null
            const cancelledInputs = cancelPendingSessionInputs(sessionId, session, stoppedTurnId)
            session._pendingTurns = []
            session._generating = false
            session.activeTurnId = null
            session.activeTurnIdentity = null
            session.lastSessionId = session.lastSessionId || sessionId
            const completedAt = Date.now()
            session.taskCompletedAt = completedAt
            const startedAt = Number(session.taskStartedAt || session.taskState?.startedAt || completedAt)
            updateTaskState(session, sessionId, taskStateForStop({sdkSessionId: session.lastSessionId, historySessionId: session.lastSessionId, startedAt, completedAt, durationMs: Math.max(0, completedAt - startedAt)}))
            appendSessionEvent(session, 'runtime/stopped', {turnId: stoppedTurnId, cancelledInputs, durationMs: session.taskState.durationMs})
            getBroadcastTurn()(sessionId, {type: 'generation_stopped', turnId: stoppedTurnId, durationMs: session.taskState.durationMs, taskState: getTaskStateForClient()(session.taskState)}, stoppedTurnIdentity)
            broadcastTaskLifecycle(sessionId)
            return {stopped: true, scope: 'primary', cancelledInputs, turnId: stoppedTurnId}
        })()
        session._stopPromise = operation
        try {
            return await operation
        } finally {
            if (session._stopPromise === operation) session._stopPromise = null
        }
    }

    return {stopSessionGeneration}
}
