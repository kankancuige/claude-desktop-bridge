const VERSION = 4
const MAX_DETAIL_LENGTH = 2000
const STATUSES = new Set(['idle', 'running', 'reviewing', 'changes_required', 'fixing', 'review_paused', 'succeeded', 'incomplete', 'failed', 'stopped', 'interrupted'])
const OUTCOMES = new Set(['succeeded', 'incomplete', 'failed'])
const REASONS = new Set(['max_turns', 'max_budget', 'execution_error', 'structured_output', 'stopped', 'unknown_error', null])

function text(value, max = MAX_DETAIL_LENGTH) {
    return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function redactTaskDetail(value) {
    return text(value)
        .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
        .replace(/\b(?:sk|key|token)-[A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]')
        .replace(/((?:api[_-]?key|auth[_-]?token|access[_-]?token|password|secret)\s*[=:]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]')
        .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
}

export function normalizeTaskState(raw = {}, {recoverRunning = false, now = Date.now()} = {}) {
    const input = raw && typeof raw === 'object' ? raw : {}
    let status = STATUSES.has(input.status) ? input.status : 'idle'
    let outcome = OUTCOMES.has(input.outcome) ? input.outcome : null
    let reason = REASONS.has(input.continuationReason) ? input.continuationReason : null
    let resumable = input.resumable === true
    if (recoverRunning && status === 'running') {
        status = 'interrupted'
        outcome = 'failed'
        reason = 'execution_error'
        resumable = Boolean(input.historySessionId || input.sdkSessionId || input.resumable)
    }
    if (status === 'reviewing' || status === 'changes_required' || status === 'fixing' || status === 'review_paused') {
        // 审查中间态不能在恢复或投影时被误判为成功；保留原阶段供用户继续处理。
        outcome = null
        resumable = true
        reason = status === 'review_paused' ? 'execution_error' : null
    } else if (status === 'succeeded') {
        outcome = 'succeeded'
        reason = null
        resumable = false
    } else if (status === 'incomplete') {
        outcome = 'incomplete'
        resumable = true
    } else if (status === 'interrupted' || status === 'stopped') {
        outcome = 'failed'
        reason = reason || (status === 'stopped' ? 'stopped' : 'execution_error')
    }
    return {
        version: VERSION,
        status,
        outcome,
        continuationReason: reason,
        resumable,
        subtype: text(input.subtype, 120) || null,
        sdkSessionId: text(input.sdkSessionId, 160) || null,
        historySessionId: text(input.historySessionId, 160) || null,
        taskId: text(input.taskId, 200) || null,
        turnId: text(input.turnId, 200) || null,
        sequence: Number.isFinite(Number(input.sequence)) ? Math.max(0, Math.trunc(Number(input.sequence))) : 0,
        numTurns: Number.isFinite(Number(input.numTurns)) ? Math.max(0, Math.min(100000, Math.trunc(Number(input.numTurns)))) : 0,
        startedAt: Number.isFinite(Number(input.startedAt)) ? Math.max(0, Number(input.startedAt)) : 0,
        completedAt: Number.isFinite(Number(input.completedAt)) ? Math.max(0, Number(input.completedAt)) : 0,
        durationMs: Number.isFinite(Number(input.durationMs)) ? Math.max(0, Number(input.durationMs)) : 0,
        detail: redactTaskDetail(input.detail),
        review: normalizeReviewProjection(input.review),
        updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : now,
    }
}

function normalizeReviewProjection(value) {
    const input = value && typeof value === 'object' ? value : {}
    const findings = Array.isArray(input.blockingFindings) ? input.blockingFindings.slice(0, 20).map(item => ({
        severity: typeof item?.severity === 'string' ? item.severity.slice(0, 20) : 'medium',
        title: text(item?.title, 300),
        file: text(item?.file, 500),
        line: Number.isFinite(Number(item?.line)) ? Math.max(1, Math.trunc(Number(item.line))) : null,
        description: text(item?.description, 1000),
    })) : []
    return {
        round: Number.isFinite(Number(input.round)) ? Math.max(0, Math.min(2, Math.trunc(Number(input.round)))) : 0,
        tier: input.tier === 'power' ? 'power' : input.tier === 'balanced' ? 'balanced' : null,
        summary: text(input.summary, 1000),
        blockingCount: findings.length,
        blockingFindings: findings,
    }
}

export function taskStateFileId(gatewaySessionId, sdkSessionId) {
    const value = text(gatewaySessionId, 160) || text(sdkSessionId, 160)
    return value || null
}

export function createTaskStatePatch(input = {}) {
    return normalizeTaskState({...input, updatedAt: input.updatedAt ?? Date.now()})
}

export function taskStateFromResult(result = {}, identity = {}) {
    const outcome = result.outcome === 'succeeded' || result.subtype === 'success'
        ? 'succeeded'
        : result.outcome === 'incomplete' || result.continuationReason === 'max_turns'
            ? 'incomplete'
            : 'failed'
    return createTaskStatePatch({
        status: outcome === 'succeeded' ? 'succeeded' : outcome === 'incomplete' ? 'incomplete' : 'failed',
        outcome,
        continuationReason: result.continuationReason || null,
        resumable: result.resumable === true,
        subtype: result.subtype,
        detail: result.result || result.detail || result.errors?.join('\n') || '',
        numTurns: result.numTurns,
        startedAt: identity.startedAt,
        completedAt: identity.completedAt,
        durationMs: identity.durationMs,
        sdkSessionId: identity.sdkSessionId,
        historySessionId: identity.historySessionId || identity.sdkSessionId,
    })
}

export function taskStateForStop(identity = {}) {
    return createTaskStatePatch({
        status: 'stopped',
        outcome: 'failed',
        continuationReason: 'stopped',
        resumable: Boolean(identity.sdkSessionId || identity.historySessionId),
        sdkSessionId: identity.sdkSessionId,
        historySessionId: identity.historySessionId || identity.sdkSessionId,
        startedAt: identity.startedAt,
        completedAt: identity.completedAt,
        durationMs: identity.durationMs,
    })
}

export function taskStateForError(error, identity = {}) {
    return createTaskStatePatch({
        status: 'interrupted',
        outcome: 'failed',
        continuationReason: 'execution_error',
        resumable: Boolean(identity.sdkSessionId || identity.historySessionId),
        detail: error?.message || error,
        sdkSessionId: identity.sdkSessionId,
        historySessionId: identity.historySessionId || identity.sdkSessionId,
        startedAt: identity.startedAt,
        completedAt: identity.completedAt,
        durationMs: identity.durationMs,
    })
}

export function recoverTaskState(raw, options = {}) {
    return normalizeTaskState(raw, {...options, recoverRunning: true})
}

export function isTaskResumable(state) {
    const normalized = normalizeTaskState(state)
    return normalized.resumable === true && normalized.status !== 'succeeded'
}

export function taskStateForClient(state) {
    const normalized = normalizeTaskState(state)
    return {
        status: normalized.status,
        outcome: normalized.outcome,
        continuationReason: normalized.continuationReason,
        resumable: normalized.resumable,
        subtype: normalized.subtype,
        taskId: normalized.taskId,
        turnId: normalized.turnId,
        sequence: normalized.sequence,
        numTurns: normalized.numTurns,
        startedAt: normalized.startedAt,
        completedAt: normalized.completedAt,
        durationMs: normalized.durationMs,
        detail: normalized.detail,
        review: normalized.review,
        updatedAt: normalized.updatedAt,
    }
}
