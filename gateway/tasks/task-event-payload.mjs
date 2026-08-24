const MAX_TEXT = 4000

function text(value, max = MAX_TEXT) {
    return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function buildTaskEventPayload(type, session = {}, extra = {}) {
    const taskState = session?.taskState || {}
    const payload = {
        taskId: text(extra.taskId || session.taskCompletionTaskId || taskState.taskId, 240) || null,
        sessionId: text(extra.sessionId || session.id || session.sessionId, 240) || null,
        turnId: text(extra.turnId || session.taskCompletionTurnId || taskState.turnId, 240) || null,
        source: text(extra.source || session.taskCompletionIdentity?.source || session.source || 'desktop', 64) || 'desktop',
        sequence: Number.isFinite(Number(extra.sequence ?? session._taskCompletionSequence ?? taskState.sequence)) ? Math.max(0, Math.trunc(Number(extra.sequence ?? session._taskCompletionSequence ?? taskState.sequence))) : 0,
        revision: Number.isFinite(Number(extra.revision ?? session._taskStateRevision)) ? Math.max(0, Math.trunc(Number(extra.revision ?? session._taskStateRevision))) : 0,
        at: Number.isFinite(Number(extra.at)) ? Number(extra.at) : Date.now(),
    }
    for (const [key, value] of Object.entries(extra || {})) {
        if (['taskId', 'sessionId', 'turnId', 'source', 'sequence', 'revision', 'at'].includes(key)) continue
        if (value == null) continue
        if (typeof value === 'string') payload[key] = text(value)
        else if (typeof value === 'number' || typeof value === 'boolean') payload[key] = value
        else if (Array.isArray(value)) payload[key] = value.slice(0, 20)
        else if (typeof value === 'object') payload[key] = value
    }
    return {type: text(type, 120), payload}
}
