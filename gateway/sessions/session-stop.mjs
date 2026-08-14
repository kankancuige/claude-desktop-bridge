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
