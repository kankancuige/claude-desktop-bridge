const TASK_PHASES = new Set([
    'idle', 'running', 'reviewing', 'changes_required', 'fixing',
    'review_paused', 'succeeded', 'incomplete', 'failed', 'stopped', 'interrupted',
])

const BLOCKING_SEVERITIES = new Set(['critical', 'high'])
const MAX_FINDINGS = 20
const MAX_TEXT = 1000

function text(value, max = MAX_TEXT) {
    return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function unique(values) {
    return [...new Set(values.filter(Boolean))]
}

function normalizeFinding(raw = {}) {
    return {
        severity: ['critical', 'high', 'medium', 'low'].includes(raw.severity) ? raw.severity : 'medium',
        blocking: raw.blocking === true,
        title: text(raw.title, 300) || '未命名问题',
        description: text(raw.description, MAX_TEXT),
        file: text(raw.file, 500),
        line: Number.isFinite(Number(raw.line)) ? Math.max(1, Math.trunc(Number(raw.line))) : null,
        suggestion: text(raw.suggestion || raw.fixSuggestion, MAX_TEXT),
    }
}

function findingsFromResult(result = {}) {
    const candidates = [
        result.findings,
        result.confirmed,
        result.bugs,
        result.blockingFindings,
        result.advisoryFindings,
    ]
    return candidates.flatMap(value => Array.isArray(value) ? value : []).slice(0, MAX_FINDINGS).map(normalizeFinding)
}

function riskDomainsFromDecision(decision = {}) {
    const domains = ['correctness']
    const triggers = new Set(Array.isArray(decision.hardTriggers) ? decision.hardTriggers : [])
    if (triggers.has('concurrency_or_lifecycle')) domains.push('concurrency')
    if (triggers.has('authentication_or_secret')) domains.push('security')
    if (triggers.has('protocol_or_streaming')) domains.push('protocol')
    if (triggers.has('session_identity_or_persistence')) domains.push('persistence')
    if (triggers.has('im_delivery')) domains.push('delivery')
    if (triggers.has('public_contract')) domains.push('compatibility')
    if (triggers.has('destructive_or_migration')) domains.push('migration')
    return unique(domains)
}

export function resolveFinalReviewPlan({decision = {}, checkpoint = null} = {}) {
    const files = Array.isArray(checkpoint?.files) ? checkpoint.files : []
    const totalLines = files.reduce((sum, file) => sum + Math.max(0, Number(file?.added) || 0) + Math.max(0, Number(file?.removed) || 0), 0)
    const onlyLowRiskArtifacts = files.length > 0 && files.every(file => /(?:\.md|\.css|\.scss|\.less|\.json|\.d\.ts)$/i.test(String(file?.path || '')))
    const hardTriggers = Array.isArray(decision.hardTriggers) ? decision.hardTriggers : []
    const touchesCriticalPath = files.some(file => /(?:^|\/)gateway\/(?:index|workflow-runner|workflow-child|.*-proxy)\.mjs$/i.test(String(file?.path || '').replace(/\\/g, '/')))
    const smallOrdinaryChange = decision.risk === 'medium' && hardTriggers.length === 0 && !touchesCriticalPath && files.length <= 2 && totalLines <= 30
    if (!files.length || decision.finalReview === 'none' || decision.risk === 'low' && !touchesCriticalPath || onlyLowRiskArtifacts && totalLines <= 50 || smallOrdinaryChange) {
        return {required: false, tier: 'none', mode: 'none', riskDomains: []}
    }
    if (touchesCriticalPath || totalLines >= 500 || files.length >= 12 || decision.risk === 'high' || decision.risk === 'critical' || decision.finalReview === 'power') {
        return {
            required: true,
            tier: 'power',
            mode: 'gate',
            riskDomains: riskDomainsFromDecision(decision),
        }
    }
    return {
        required: true,
        tier: 'balanced',
        mode: 'focused',
        riskDomains: ['correctness'],
    }
}

export function normalizeReviewOutcome(result = {}, plan = {}) {
    const findings = findingsFromResult(result)
    const blockingFindings = findings.filter(item => item.blocking || BLOCKING_SEVERITIES.has(item.severity))
    const advisoryFindings = findings.filter(item => !item.blocking && !BLOCKING_SEVERITIES.has(item.severity))
    const explicitPassed = typeof result.passed === 'boolean' ? result.passed : null
    return {
        passed: explicitPassed === false ? false : blockingFindings.length === 0,
        blockingFindings,
        advisoryFindings,
        summary: text(result.summary || result.report, 2000)
            || (blockingFindings.length ? `发现 ${blockingFindings.length} 个阻断问题` : '审查通过'),
        tier: plan.tier === 'power' ? 'power' : 'balanced',
    }
}

export function createTaskCompletionState(input = {}) {
    return {
        version: 1,
        phase: TASK_PHASES.has(input.phase) ? input.phase : 'idle',
        primaryResult: input.primaryResult || null,
        reviewPlan: input.reviewPlan || null,
        reviewRound: Math.max(0, Math.min(2, Math.trunc(Number(input.reviewRound) || 0))),
        fixAttempts: Math.max(0, Math.min(1, Math.trunc(Number(input.fixAttempts) || 0))),
        reviewOutcome: input.reviewOutcome || null,
        detail: text(input.detail, 2000),
        completionEmitted: input.completionEmitted === true,
        notificationEmitted: input.notificationEmitted === true,
        updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : Date.now(),
    }
}

function resultPhase(result = {}) {
    if (result.outcome === 'incomplete') return 'incomplete'
    if (result.outcome === 'succeeded') return 'succeeded'
    return 'failed'
}

function finish(state, type, detail = '') {
    if (state.completionEmitted) return {state, effects: []}
    const phase = type === 'complete' ? 'succeeded' : type === 'pause' ? 'review_paused' : 'failed'
    return {
        state: createTaskCompletionState({
            ...state,
            phase,
            detail: detail || state.detail,
            completionEmitted: type === 'complete',
        }),
        effects: [{type, detail: detail || state.detail}],
    }
}

export function transitionTaskCompletion(current, event = {}) {
    const state = createTaskCompletionState(current)
    if (!event?.type) return {state, effects: []}

    if (event.type === 'notification_sent') {
        if (state.notificationEmitted) return {state, effects: []}
        return {state: createTaskCompletionState({...state, notificationEmitted: true}), effects: []}
    }

    if (state.phase === 'succeeded' || state.phase === 'failed' || state.phase === 'incomplete' || state.phase === 'stopped' || state.phase === 'interrupted') {
        return {state, effects: []}
    }

    if (event.type === 'primary_result') {
        if (state.phase === 'reviewing') return {state, effects: []}
        const primaryResult = event.result || {}
        const terminalPhase = resultPhase(primaryResult)
        if (terminalPhase !== 'succeeded') {
            return {
                state: createTaskCompletionState({...state, phase: terminalPhase, primaryResult, detail: primaryResult.detail || ''}),
                effects: [{type: terminalPhase === 'incomplete' ? 'pause' : 'fail', detail: primaryResult.detail || ''}],
            }
        }
        const reviewPlan = event.reviewPlan || state.reviewPlan || {required: false, tier: 'none', mode: 'none', riskDomains: []}
        if (!reviewPlan.required) {
            return finish(createTaskCompletionState({...state, primaryResult, reviewPlan}), 'complete')
        }
        const reviewRound = state.phase === 'fixing' || state.fixAttempts > 0 ? 2 : 1
        const next = createTaskCompletionState({
            ...state,
            phase: 'reviewing',
            primaryResult,
            reviewPlan,
            reviewRound,
            reviewOutcome: null,
            detail: '',
        })
        return {state: next, effects: [{type: 'start_review', plan: reviewPlan, round: reviewRound}]}
    }

    if (event.type === 'review_result') {
        if (state.phase !== 'reviewing') return {state, effects: []}
        const outcome = event.outcome || normalizeReviewOutcome(event.result, state.reviewPlan)
        if (outcome.passed) {
            return finish(createTaskCompletionState({...state, reviewOutcome: outcome}), 'complete', outcome.summary)
        }
        if (state.fixAttempts === 0 && state.reviewRound < 2) {
            const next = createTaskCompletionState({
                ...state,
                phase: 'changes_required',
                fixAttempts: 1,
                reviewOutcome: outcome,
                detail: outcome.summary,
            })
            return {state: next, effects: [{type: 'request_fix', outcome}]}
        }
        return finish(createTaskCompletionState({...state, reviewOutcome: outcome}), 'fail', outcome.summary)
    }

    if (event.type === 'fix_started') {
        if (state.phase !== 'changes_required') return {state, effects: []}
        return {state: createTaskCompletionState({...state, phase: 'fixing'}), effects: []}
    }

    if (event.type === 'review_paused') {
        if (state.phase !== 'reviewing') return {state, effects: []}
        return finish(state, 'pause', text(event.detail, 2000) || '最终审查已暂停')
    }

    if (event.type === 'review_error') {
        if (state.phase !== 'reviewing') return {state, effects: []}
        return finish(state, 'fail', text(event.detail, 2000) || '最终审查执行失败')
    }

    return {state, effects: []}
}
