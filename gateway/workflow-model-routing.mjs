export function inferWorkflowAgentTier({label, phase, workflowTier} = {}) {
    const normalizedLabel = String(label || '').toLowerCase()
    const normalizedPhase = String(phase || '').toLowerCase()
    if (/^(?:risk-classify|scope-check)/.test(normalizedLabel) || /^(?:size|scope)$/.test(normalizedPhase)) return 'light'
    if (/^(?:verify|completeness|report|deepdive|synthesize|draft|plan|judge)$/.test(normalizedPhase)) return 'power'
    if (/^(?:review|hunt|scan|execute)$/.test(normalizedPhase)) return 'balanced'
    return workflowTier || 'balanced'
}

export function resolveWorkflowAgentModel({fixedModel, model, modelTier, forcedModelTier, workflowTier, modelTiers = {}} = {}) {
    const fixed = String(fixedModel || '').trim()
    if (fixed) return {model: fixed, source: 'fixed', tier: null}
    const explicit = forcedModelTier ? '' : String(model || '').trim()
    if (explicit) return {model: explicit, source: 'explicit', tier: null}
    const tier = forcedModelTier || modelTier || workflowTier || 'balanced'
    const resolved = String(modelTiers?.[tier] || '').trim()
    return {model: resolved || null, source: resolved ? 'tier' : 'unconfigured', tier}
}

export function assertWorkflowAgentModel(route) {
    if (route?.source === 'unconfigured' && route?.tier === 'power') {
        const error = new Error('高风险 Workflow Agent 需要先配置 Power 模型')
        error.code = 'WORKFLOW_POWER_MODEL_REQUIRED'
        throw error
    }
    return route
}

export function resolveWorkflowFinalReviewTier({risk, requestedTier} = {}) {
    if (risk === 'critical' || risk === 'high') return 'power'
    return requestedTier || 'balanced'
}

export function shouldAutoTriggerWorkflow(decision) {
    if (!decision || decision.contextProfile === 'light') return false
    return !['implement', 'operate', 'refactor'].includes(decision.action)
        && Boolean(decision.workflow && decision.workflow !== 'none')
}

export function shouldAutoTriggerFinalReview({decision, outcome, changedFileCount = 0} = {}) {
    return outcome === 'succeeded'
        && decision?.finalReview === 'power'
        && Number(changedFileCount) > 0
}

export function resolveWorkflowPermissionMode({parentPermissionMode, agentPermissionMode} = {}) {
    return parentPermissionMode || agentPermissionMode || 'acceptEdits'
}
