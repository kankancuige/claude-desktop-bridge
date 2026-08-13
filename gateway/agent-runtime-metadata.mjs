const TIER_LABELS = {light: 'Light', balanced: 'Balanced', power: 'Power'}

export function buildAgentRuntimeMetadata({
    id,
    agentType,
    label,
    phase,
    prompt,
    modelRoute,
    actualModel,
    workflowName,
    runKey,
} = {}) {
    const requestedTier = modelRoute?.tier || null
    const source = modelRoute?.source || 'unknown'
    return {
        id: String(id || label || 'agent'),
        agentType: String(agentType || label || 'general-purpose'),
        role: String(agentType || label || 'general-purpose'),
        task: String(prompt || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 240),
        phase: String(phase || ''),
        requestedModelTier: requestedTier,
        requestedModelTierLabel: requestedTier ? TIER_LABELS[requestedTier] || requestedTier : null,
        actualModel: String(actualModel || modelRoute?.model || ''),
        modelSource: source,
        fallbackReason: source === 'unconfigured' ? `${requestedTier || 'balanced'}_model_unconfigured` : null,
        required: String(runKey || '').startsWith('final-review:'),
        workflowName: String(workflowName || ''),
    }
}
