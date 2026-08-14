import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeExplicitModel, resolveTaskModelRoute, resolveTurnModelRoute, shouldDeferAutomaticQuery, shouldValidateProviderModel, validateProviderModel} from './model-routing.mjs'

const tiers = {light: 'model-light', balanced: 'model-balanced', power: 'model-power'}

test('自动模式按 TaskDecision 档位选择模型', () => {
    const route = resolveTaskModelRoute({
        modelMode: 'auto', explicitModel: '', decision: {modelTier: 'power', risk: 'high'},
        modelTiers: tiers, defaultModel: 'model-default',
    })
    assert.deepEqual(route, {
        mode: 'auto', tier: 'power', model: 'model-power', configured: true,
        fallbackReason: null, blockingReason: null,
    })
})

test('固定模式和旧客户端显式模型不被自动覆盖', () => {
    for (const modelMode of ['fixed', undefined]) {
        const route = resolveTaskModelRoute({
            modelMode, explicitModel: 'user-model', decision: {modelTier: 'power', risk: 'critical'},
            modelTiers: tiers, defaultModel: 'model-default',
        })
        assert.equal(route.mode, 'fixed')
        assert.equal(route.model, 'user-model')
        assert.equal(route.tier, null)
    }
})

test('自动档位未配置时低中风险显式回退默认模型', () => {
    const route = resolveTaskModelRoute({
        modelMode: 'auto', decision: {modelTier: 'balanced', risk: 'medium'},
        modelTiers: {light: 'model-light'}, defaultModel: 'model-default',
    })
    assert.equal(route.model, 'model-default')
    assert.equal(route.fallbackReason, 'tier_model_unconfigured')
    assert.equal(route.blockingReason, null)
})

test('高风险任务没有 Power 配置时标记阻断而不是静默降级', () => {
    const route = resolveTaskModelRoute({
        modelMode: 'auto', decision: {modelTier: 'power', risk: 'high'},
        modelTiers: {balanced: 'model-balanced'}, defaultModel: 'model-default',
    })
    assert.equal(route.model, '')
    assert.equal(route.blockingReason, 'power_model_required')
    assert.equal(route.fallbackReason, 'tier_model_unconfigured')
})

test('自动模式没有任何默认模型时返回配置阻断', () => {
    const route = resolveTaskModelRoute({
        modelMode: 'auto', decision: {modelTier: 'light', risk: 'low'}, modelTiers: {}, defaultModel: '',
    })
    assert.equal(route.model, '')
    assert.equal(route.blockingReason, 'model_unavailable')
})

test('Codex Relay 不静默把不兼容档位模型替换成写死模型', () => {
    const baseUrl = 'https://example.com/api/codex/backend-api/codex'
    assert.equal(validateProviderModel({baseUrl, model: 'MiniMax-M3'}), 'model_provider_incompatible')
    assert.equal(validateProviderModel({baseUrl, model: 'gpt-5.6-sol'}), null)
})

test('空自动会话延迟到首条任务再校验供应商模型', () => {
    assert.equal(shouldValidateProviderModel({modelMode: 'auto', hasTaskDecision: false}), false)
    assert.equal(shouldValidateProviderModel({modelMode: 'auto', hasTaskDecision: true}), true)
    assert.equal(shouldValidateProviderModel({modelMode: 'fixed', hasTaskDecision: false}), true)
    assert.equal(shouldDeferAutomaticQuery({modelMode: 'auto', hasTaskDecision: false}), true)
    assert.equal(shouldDeferAutomaticQuery({modelMode: 'auto', hasTaskDecision: false, hasConversationTarget: true}), false)
    assert.equal(shouldValidateProviderModel({modelMode: 'auto', hasTaskDecision: false, hasConversationTarget: true}), true)
})

test('恢复会话未显式指定模型时不注入硬编码的其他供应商模型', () => {
    assert.equal(normalizeExplicitModel(undefined), '')
    assert.equal(normalizeExplicitModel('  gpt-5.6-sol  '), 'gpt-5.6-sol')
    const currentProviderDefault = 'gpt-5.6-sol'
    const resolved = normalizeExplicitModel(undefined) || currentProviderDefault
    assert.equal(resolved, 'gpt-5.6-sol')
})

test('进行中的补充消息继承当前模型，不在工具执行中切换 Query', () => {
    const route = resolveTurnModelRoute({
        activeTurn: true,
        currentMode: 'auto',
        currentModel: 'model-power',
        currentTier: 'power',
        modelMode: 'auto',
        decision: {modelTier: 'light', risk: 'low'},
        modelTiers: tiers,
        defaultModel: 'model-default',
    })
    assert.equal(route.model, 'model-power')
    assert.equal(route.tier, 'power')
    assert.equal(route.inheritedFromActiveTurn, true)
})
