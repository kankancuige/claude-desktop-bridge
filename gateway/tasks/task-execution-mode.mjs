const EXECUTION_MODES = new Set(['session', 'workflow', 'mission'])

const POLICY_LIMITS = Object.freeze({
    maxPlanSteps: [1, 50],
    maxRounds: [1, 100],
    maxTokens: [1024, 2_000_000],
    maxDurationMs: [10_000, 24 * 60 * 60 * 1000],
    maxRetries: [0, 10],
})

const DEFAULT_POLICY = Object.freeze({
    session: {enabled: false, maxPlanSteps: 12, maxRounds: 1, maxTokens: 20_000, maxDurationMs: 30 * 60 * 1000, maxRetries: 0},
    workflow: {enabled: true, maxPlanSteps: 12, maxRounds: 20, maxTokens: 200_000, maxDurationMs: 4 * 60 * 60 * 1000, maxRetries: 2},
    mission: {enabled: true, maxPlanSteps: 20, maxRounds: 40, maxTokens: 500_000, maxDurationMs: 8 * 60 * 60 * 1000, maxRetries: 3},
})

function boundedNumber(value, [minimum, maximum], fallback) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)))
}

export function normalizeExecutionMode(value) {
    const mode = String(value || '').trim().toLowerCase()
    return EXECUTION_MODES.has(mode) ? mode : 'session'
}

export function normalizeContinuationPolicy(value = {}, mode = 'session') {
    const normalizedMode = normalizeExecutionMode(mode)
    const defaults = DEFAULT_POLICY[normalizedMode]
    const input = value && typeof value === 'object' ? value : {}
    return {
        enabled: input.enabled === true || normalizedMode !== 'session' && input.enabled !== false,
        maxPlanSteps: boundedNumber(input.maxPlanSteps, POLICY_LIMITS.maxPlanSteps, defaults.maxPlanSteps),
        maxRounds: boundedNumber(input.maxRounds, POLICY_LIMITS.maxRounds, defaults.maxRounds),
        maxTokens: boundedNumber(input.maxTokens, POLICY_LIMITS.maxTokens, defaults.maxTokens),
        maxDurationMs: boundedNumber(input.maxDurationMs, POLICY_LIMITS.maxDurationMs, defaults.maxDurationMs),
        maxRetries: boundedNumber(input.maxRetries, POLICY_LIMITS.maxRetries, defaults.maxRetries),
    }
}

export function validateStepDependencies(steps = []) {
    const rows = Array.isArray(steps) ? steps : []
    const known = new Set(rows.map(step => String(step?.stepId || '')).filter(Boolean))
    const visiting = new Set()
    const visited = new Set()
    for (const step of rows) {
        const id = String(step?.stepId || '')
        const dependencies = Array.isArray(step?.dependsOn) ? step.dependsOn.map(String) : []
        for (const dependency of dependencies) {
            if (!known.has(dependency)) throw Object.assign(new TypeError(`步骤依赖不存在: ${dependency}`), {code: 'TASK_STEP_DEPENDENCY_MISSING'})
        }
        const visit = current => {
            if (visiting.has(current)) throw Object.assign(new TypeError('Task Plan 步骤存在循环依赖'), {code: 'TASK_STEP_DEPENDENCY_CYCLE'})
            if (visited.has(current)) return
            visiting.add(current)
            const target = rows.find(item => String(item?.stepId || '') === current)
            for (const dependency of Array.isArray(target?.dependsOn) ? target.dependsOn : []) visit(String(dependency))
            visiting.delete(current)
            visited.add(current)
        }
        if (id) visit(id)
    }
    return true
}

export function createTaskRunBudget(policy = {}, mode = 'session') {
    const continuationPolicy = normalizeContinuationPolicy(policy, mode)
    return {
        ...continuationPolicy,
        maxMessageHops: boundedNumber(policy.maxMessageHops, [0, 20], 4),
        maxAgents: boundedNumber(policy.maxAgents, [0, 20], mode === 'session' ? 1 : mode === 'workflow' ? 8 : 12),
        roundsUsed: 0,
        tokensUsed: 0,
        retriesUsed: 0,
        messageHopsUsed: 0,
        agentsStarted: 0,
        startedAt: Number(policy.startedAt) > 0 ? Number(policy.startedAt) : Date.now(),
    }
}

export function consumeTaskRunBudget(budget, usage = {}) {
    if (!budget || typeof budget !== 'object') return {allowed: false, remaining: null, reason: 'budget_missing'}
    const next = {
        ...budget,
        roundsUsed: Math.max(0, Number(budget.roundsUsed || 0) + Math.max(0, Number(usage.rounds || 0))),
        tokensUsed: Math.max(0, Number(budget.tokensUsed || 0) + Math.max(0, Number(usage.tokens || 0))),
        retriesUsed: Math.max(0, Number(budget.retriesUsed || 0) + Math.max(0, Number(usage.retries || 0))),
        messageHopsUsed: Math.max(0, Number(budget.messageHopsUsed || 0) + Math.max(0, Number(usage.messageHops || 0))),
        agentsStarted: Math.max(0, Number(budget.agentsStarted || 0) + Math.max(0, Number(usage.agents || 0))),
    }
    const elapsed = Math.max(0, Date.now() - Number(next.startedAt || Date.now()))
    const reason = next.roundsUsed > next.maxRounds ? 'max_rounds'
        : next.tokensUsed > next.maxTokens ? 'max_tokens'
            : elapsed > next.maxDurationMs ? 'max_duration'
                : next.retriesUsed > next.maxRetries ? 'max_retries'
                    : next.messageHopsUsed > next.maxMessageHops ? 'max_message_hops'
                        : next.agentsStarted > next.maxAgents ? 'max_agents' : null
    return {
        allowed: !reason,
        remaining: {
            rounds: Math.max(0, next.maxRounds - next.roundsUsed),
            tokens: Math.max(0, next.maxTokens - next.tokensUsed),
            retries: Math.max(0, next.maxRetries - next.retriesUsed),
            messageHops: Math.max(0, next.maxMessageHops - next.messageHopsUsed),
            agents: Math.max(0, next.maxAgents - next.agentsStarted),
            durationMs: Math.max(0, next.maxDurationMs - elapsed),
        },
        reason,
        budget: next,
    }
}

export function resolveContinuation({mode = 'session', result = {}, budget = null, progress = null} = {}) {
    const normalizedMode = normalizeExecutionMode(mode)
    if (normalizedMode === 'session') return {action: 'pause', reason: 'session_mode'}
    if (result?.blocked === true || result?.status === 'blocked') return {action: 'pause', reason: 'blocked'}
    if (result?.waitingForEvent === true) return {action: 'pause', reason: 'waiting_for_event'}
    if (progress === false) return {action: 'pause', reason: 'no_progress'}
    const consumed = budget ? consumeTaskRunBudget(budget, {rounds: 1}) : {allowed: true, reason: null}
    if (!consumed.allowed) return {action: 'pause', reason: consumed.reason, budget: consumed.budget || budget, remaining: consumed.remaining}
    if (result?.completed === true || result?.outcome === 'completed') return {action: 'complete', reason: 'completed'}
    return {action: 'continue', reason: normalizedMode === 'mission' ? 'mission_budgeted' : 'next_plan_step', budget: consumed.budget, remaining: consumed.remaining}
}
