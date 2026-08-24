const VERSION = 6
const MAX_DETAIL_LENGTH = 2000
const MAX_REPLY_LENGTH = 12000
const STATUSES = new Set(['idle', 'running', 'reviewing', 'changes_required', 'fixing', 'review_paused', 'succeeded', 'incomplete', 'failed', 'stopped', 'interrupted'])
const OUTCOMES = new Set(['succeeded', 'incomplete', 'failed'])
const REASONS = new Set([
    'max_turns', 'max_budget', 'max_rounds', 'max_tokens', 'max_duration',
    'max_retries', 'max_message_hops', 'max_agents', 'no_progress',
    'session_mode', 'blocked', 'waiting_for_event', 'execution_error',
    'structured_output', 'stopped', 'unknown_error', null,
])
const NOTIFICATION_STATES = new Set(['pending', 'sent', 'failed', 'dead'])
const PERMISSION_MODES = new Set(['default', 'acceptEdits', 'plan', 'bypassPermissions'])

function text(value, max = MAX_DETAIL_LENGTH) {
    return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function redactTaskDetail(value, max = MAX_DETAIL_LENGTH) {
    return text(value, max)
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
    const normalized = {
        version: VERSION,
        status,
        outcome,
        continuationReason: reason,
        resumable,
        permissionMode: PERMISSION_MODES.has(input.permissionMode) ? input.permissionMode : 'default',
        // 仅持久化实际路由的模型标识，用于重启后判断跨模型上下文策略；不包含 Provider 配置。
        model: text(input.model, 256) || null,
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
        finalReplyText: redactTaskDetail(input.finalReplyText, MAX_REPLY_LENGTH),
        finalReplyAvailable: input.finalReplyAvailable === true || Boolean(input.finalReplyText),
        notifications: normalizeNotifications(input.notifications),
        review: normalizeReviewProjection(input.review),
        updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : now,
    }
    if (Object.prototype.hasOwnProperty.call(input, 'execution')) normalized.execution = normalizeExecutionProjection(input.execution)
    if (Object.prototype.hasOwnProperty.call(input, 'context')) normalized.context = normalizeContextProjection(input.context)
    if (['title', 'summary', 'goal', 'requestText', 'source', 'projectKey'].some(key => Object.prototype.hasOwnProperty.call(input, key))) {
        Object.assign(normalized, {
            title: text(input.title, 80),
            summary: text(input.summary, 4000),
            goal: text(input.goal, 4000),
            requestText: text(input.requestText, 12000),
            source: text(input.source, 64) || 'desktop',
            projectKey: text(input.projectKey, 240),
        })
    }
    return normalized
}

function normalizeNotifications(value) {
    const input = value && typeof value === 'object' ? value : {}
    const result = {}
    for (const platform of ['wechat', 'feishu', 'dingtalk']) {
        const item = input[platform]
        if (!item || typeof item !== 'object' || !NOTIFICATION_STATES.has(item.state)) continue
        result[platform] = {
            state: item.state,
            notificationId: text(item.notificationId, 300),
            lastError: redactTaskDetail(item.lastError, 300),
            updatedAt: Number.isFinite(Number(item.updatedAt)) ? Math.max(0, Number(item.updatedAt)) : 0,
        }
    }
    return result
}

function normalizeExecutionProjection(value) {
    const input = value && typeof value === 'object' ? value : {}
    const budget = input.budget && typeof input.budget === 'object' ? input.budget : {}
    return {
        mode: ['session', 'workflow', 'mission'].includes(input.mode) ? input.mode : 'session',
        currentStepId: text(input.currentStepId, 240) || null,
        completedStepCount: Math.max(0, Math.trunc(Number(input.completedStepCount) || 0)),
        totalStepCount: Math.max(0, Math.trunc(Number(input.totalStepCount) || 0)),
        continuationCount: Math.max(0, Math.trunc(Number(input.continuationCount) || 0)),
        budget: {
            maxRounds: Math.max(0, Math.trunc(Number(budget.maxRounds) || 0)),
            maxTokens: Math.max(0, Math.trunc(Number(budget.maxTokens) || 0)),
            maxDurationMs: Math.max(0, Math.trunc(Number(budget.maxDurationMs) || 0)),
            maxRetries: Math.max(0, Math.trunc(Number(budget.maxRetries) || 0)),
            roundsUsed: Math.max(0, Math.trunc(Number(budget.roundsUsed) || 0)),
            tokensUsed: Math.max(0, Math.trunc(Number(budget.tokensUsed) || 0)),
            retriesUsed: Math.max(0, Math.trunc(Number(budget.retriesUsed) || 0)),
            remaining: budget.remaining && typeof budget.remaining === 'object' ? {
                rounds: Math.max(0, Math.trunc(Number(budget.remaining.rounds) || 0)),
                tokens: Math.max(0, Math.trunc(Number(budget.remaining.tokens) || 0)),
                durationMs: Math.max(0, Math.trunc(Number(budget.remaining.durationMs) || 0)),
            } : null,
        },
    }
}

function normalizeContextProjection(value) {
    const input = value && typeof value === 'object' ? value : {}
    return {
        profile: ['light', 'focused', 'full'].includes(input.profile) ? input.profile : 'full',
        estimatedInputTokens: Math.max(0, Math.trunc(Number(input.estimatedInputTokens) || 0)),
        maxInputTokens: Math.max(0, Math.trunc(Number(input.maxInputTokens) || 0)),
        selectedLayers: (Array.isArray(input.selectedLayers) ? input.selectedLayers : []).filter(layer => ['l0', 'l1', 'l2'].includes(layer)).slice(0, 3),
        omitted: (Array.isArray(input.omitted) ? input.omitted : []).slice(0, 20).map(item => ({layer: text(item?.layer, 10), reason: text(item?.reason, 80)})),
        references: (Array.isArray(input.references) ? input.references : []).slice(0, 20).map(item => ({sourceKey: text(item?.sourceKey, 240), title: text(item?.title, 160), score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null})),
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

export function taskStateForInconclusive(current = {}, {
    detail = '验证不足，任务尚未完成', completedAt = Date.now(),
} = {}) {
    const startedAt = Number(current?.startedAt || 0)
    return createTaskStatePatch({
        ...current,
        status: 'incomplete',
        outcome: 'incomplete',
        continuationReason: null,
        resumable: true,
        detail,
        completedAt,
        durationMs: startedAt ? Math.max(0, completedAt - startedAt) : 0,
    })
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
    const result = {
        status: normalized.status,
        outcome: normalized.outcome,
        continuationReason: normalized.continuationReason,
        resumable: normalized.resumable,
        permissionMode: normalized.permissionMode,
        model: normalized.model,
        subtype: normalized.subtype,
        taskId: normalized.taskId,
        turnId: normalized.turnId,
        title: normalized.title,
        summary: normalized.summary,
        goal: normalized.goal,
        requestText: normalized.requestText,
        source: normalized.source,
        projectKey: normalized.projectKey,
        sequence: normalized.sequence,
        numTurns: normalized.numTurns,
        startedAt: normalized.startedAt,
        completedAt: normalized.completedAt,
        durationMs: normalized.durationMs,
        detail: normalized.detail,
        finalReplyText: normalized.finalReplyText,
        finalReplyAvailable: normalized.finalReplyAvailable,
        notifications: normalized.notifications,
        review: normalized.review,
        updatedAt: normalized.updatedAt,
    }
    if (normalized.execution) result.execution = normalized.execution
    if (normalized.context) result.context = normalized.context
    return result
}
