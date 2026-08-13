import {isAutomaticModelMode, resolveTierModel} from './task-decision.mjs'

export function normalizeExplicitModel(model) {
    return typeof model === 'string' ? model.trim() : ''
}

export function isCodexRelayModel(model) {
    return /^(?:gpt-|o\d|codex|computer-use)/i.test(String(model || '').trim())
}

export function validateProviderModel({baseUrl, model} = {}) {
    const codexRelay = typeof baseUrl === 'string'
        && /\/api\/codex\/backend-api\/codex(?:\/|$)/i.test(baseUrl)
    if (codexRelay && !isCodexRelayModel(model)) return 'model_provider_incompatible'
    return null
}

// 自动模式创建空会话时尚未有任务决策；Query 只建立输入流，首条消息前再做真实模型校验。
export function shouldDeferAutomaticQuery({modelMode, hasTaskDecision, hasConversationTarget} = {}) {
    return modelMode === 'auto' && !hasTaskDecision && !hasConversationTarget
}

export function shouldValidateProviderModel(input = {}) {
    return !shouldDeferAutomaticQuery(input)
}

export function resolveTaskModelRoute({
    modelMode,
    explicitModel,
    decision,
    modelTiers,
    defaultModel,
} = {}) {
    const requestedModel = normalizeExplicitModel(explicitModel)
    if (!isAutomaticModelMode(modelMode, requestedModel)) {
        const model = requestedModel || String(defaultModel || '').trim()
        return {
            mode: 'fixed', tier: null, model, configured: Boolean(model),
            fallbackReason: requestedModel ? null : 'fixed_model_unconfigured',
            blockingReason: model ? null : 'model_unavailable',
        }
    }

    const resolved = resolveTierModel(decision, modelTiers, defaultModel)
    const requiresPower = decision?.modelTier === 'power'
        && (decision?.risk === 'high' || decision?.risk === 'critical')
    if (!resolved.configured && requiresPower) {
        return {...resolved, mode: 'auto', model: '', blockingReason: 'power_model_required'}
    }
    return {
        ...resolved,
        mode: 'auto',
        blockingReason: resolved.model ? null : 'model_unavailable',
    }
}

export function resolveTurnModelRoute({activeTurn, currentMode, currentModel, currentTier, ...input} = {}) {
    const model = String(currentModel || '').trim()
    if (activeTurn && model) {
        return {
            mode: currentMode === 'auto' ? 'auto' : 'fixed',
            tier: currentTier || null,
            model,
            configured: true,
            fallbackReason: null,
            blockingReason: null,
            inheritedFromActiveTurn: true,
        }
    }
    return {...resolveTaskModelRoute(input), inheritedFromActiveTurn: false}
}
