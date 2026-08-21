export function hasStoppablePrimaryWork(session) {
    if (!session) return false
    return Boolean(
        session._generating
        || session.activeTurnId
        || session.pendingTurn
        || session._rebuildPromise
        || session.pending?.size
        || session._pendingInputs?.length
        || session._pendingTurns?.length
        || session.taskCompletion?.phase === 'running'
        || session.taskCompletion?.phase === 'reviewing'
        || session.taskCompletion?.phase === 'changes_required'
        || session.taskCompletion?.phase === 'fixing'
    )
}

export function getSessionStopScope(session, workflowStates = []) {
    const workflows = Array.isArray(workflowStates) ? workflowStates : [workflowStates]
    return {
        primaryActive: hasStoppablePrimaryWork(session),
        activeWorkflows: workflows.filter(workflow => workflow?.status === 'running' || workflow?.status === 'starting'),
    }
}

export function hasStoppableSessionWork(session, workflowStates = []) {
    const scope = getSessionStopScope(session, workflowStates)
    return scope.primaryActive || scope.activeWorkflows.length > 0
}

/**
 * 当前活动回合会在主停止路径统一发送终态，不能再从待处理输入队列重复通知。
 * 其他补充输入没有独立运行时，仍需要各自的取消事件让其调用方完成收口。
 */
export function selectCancelledInputTurns(pendingInputs, activeTurnId = null) {
    const inputs = Array.isArray(pendingInputs) ? pendingInputs : []
    if (!activeTurnId) return inputs
    return inputs.filter(input => input?.turnId !== activeTurnId)
}

/**
 * Query 重建前 activeTurnId 可能尚未建立，但父任务的 turnId 已经在接收输入时持久化。
 * 停止事件必须使用同一主回合标识，才能和待处理队列进行正确去重。
 */
export function resolvePrimaryStopTurnId(session) {
    if (typeof session?.activeTurnId === 'string' && session.activeTurnId) return session.activeTurnId
    if (typeof session?.taskCompletionTurnId === 'string' && session.taskCompletionTurnId) return session.taskCompletionTurnId
    return null
}

export function buildSessionStopResponse(session, result = {}) {
    const historySessionId = typeof session?.lastSessionId === 'string' && session.lastSessionId
        ? session.lastSessionId
        : null
    return {
        stopped: result.stopped === true,
        scope: result.scope === 'primary' ? 'primary' : result.scope === 'workflow' ? 'workflow' : 'none',
        cancelledInputs: Number(result.cancelledInputs || 0),
        resumable: Boolean(historySessionId),
        historySessionId,
    }
}
