import test from 'node:test'
import assert from 'node:assert/strict'
import {buildContextEnvelope} from './context-envelope.mjs'
import {resolveContextReusePolicy} from './context-cache-policy.mjs'

function envelope(overrides = {}) {
    return buildContextEnvelope({
        providerIdentity: 'https://relay.example.test/api/anthropic',
        model: 'model-balanced',
        protocolFamily: 'claude-agent-sdk',
        resumeSessionId: 'sdk-session-1',
        permissionMode: 'default',
        thinkingLevel: 'medium',
        contextProfile: 'full',
        skillRoute: ['bridge-memory'],
        agentRoute: ['developer'],
        toolsetRevision: 'toolset-v1',
        ruleRevision: 'rules-v1',
        projectContextRevision: 'project-v1',
        ...overrides,
    })
}

test('同 Provider、同模型且稳定 envelope 只表示可能命中，不伪造 cache hit', () => {
    const policy = resolveContextReusePolicy({previous: envelope(), next: envelope()})
    assert.deepEqual(policy, {
        mode: 'reuse_same_session',
        cacheEligibility: 'same_partition_possible',
        reasonCodes: ['stable_partition', 'resume_available'],
        requiresUserChoice: false,
    })
})

test('切换模型默认完整历史重建并要求用户选择，绝不跨模型共享缓存', () => {
    const policy = resolveContextReusePolicy({
        previous: envelope(), next: envelope({model: 'model-power'}), switchIntent: 'unspecified',
    })
    assert.equal(policy.cacheEligibility, 'cross_model_unavailable')
    assert.equal(policy.mode, 'rebuild_full_history')
    assert.equal(policy.requiresUserChoice, true)
    assert.deepEqual(policy.reasonCodes, ['model_changed', 'user_choice_required'])
})

test('Provider 切换与缺失 resume 不宣称旧 Query 或缓存可复用', () => {
    const providerChanged = resolveContextReusePolicy({
        previous: envelope(), next: envelope({providerIdentity: 'https://other.example.test'}), switchIntent: 'full_history',
    })
    assert.equal(providerChanged.cacheEligibility, 'cross_model_unavailable')
    assert.equal(providerChanged.mode, 'rebuild_full_history')
    assert.deepEqual(providerChanged.reasonCodes, ['provider_changed', 'full_history_selected'])

    const noResume = resolveContextReusePolicy({previous: envelope(), next: envelope({resumeSessionId: ''})})
    assert.equal(noResume.cacheEligibility, 'same_partition_possible')
    assert.equal(noResume.mode, 'start_fresh')
    assert.deepEqual(noResume.reasonCodes, ['stable_partition', 'resume_unavailable'])
})

test('规则、Skill 或工具变化使缓存资格未知；显式 handoff 保留其语义限制', () => {
    const changedRules = resolveContextReusePolicy({
        previous: envelope(), next: envelope({ruleRevision: 'rules-v2'}),
    })
    assert.equal(changedRules.cacheEligibility, 'unknown')
    assert.equal(changedRules.mode, 'rebuild_full_history')
    assert.deepEqual(changedRules.reasonCodes, ['rules_changed', 'context_rebuild_required'])

    const handoff = resolveContextReusePolicy({
        previous: envelope(), next: envelope({model: 'model-power'}), switchIntent: 'handoff_summary',
    })
    assert.equal(handoff.mode, 'handoff_summary')
    assert.equal(handoff.cacheEligibility, 'cross_model_unavailable')
    assert.equal(handoff.requiresUserChoice, false)
    assert.deepEqual(handoff.reasonCodes, ['model_changed', 'handoff_summary_selected'])
})
