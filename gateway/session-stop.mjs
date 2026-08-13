export function hasStoppableSessionWork(session) {
    if (!session) return false
    return Boolean(
        session._generating
        || session.activeTurnId
        || session.pendingTurn
        || session._rebuildPromise
        || session.pending?.size
        || session._pendingInputs?.length
        || session._pendingTurns?.length
    )
}

export function buildSessionStopResponse(session, result = {}) {
    const historySessionId = typeof session?.lastSessionId === 'string' && session.lastSessionId
        ? session.lastSessionId
        : null
    return {
        stopped: result.stopped === true,
        cancelledInputs: Number(result.cancelledInputs || 0),
        resumable: Boolean(historySessionId),
        historySessionId,
    }
}
