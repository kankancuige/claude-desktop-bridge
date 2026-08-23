import assert from 'node:assert/strict'
import test from 'node:test'
import {resolveProviderCapabilityProfile} from './provider-capability-profile.mjs'

test('Provider capability profile 显式区分已知能力和未知能力', () => {
    const relay = resolveProviderCapabilityProfile('https://api.claudecode.net.cn/api/codex/backend-api/codex')
    assert.equal(relay.id, 'codex-relay')
    assert.equal(relay.crossModelContext, 'cross_model_unavailable')
    assert.equal(relay.cacheUsage, 'provider_observed')
    const unknown = resolveProviderCapabilityProfile('https://provider.example.test')
    assert.equal(unknown.id, 'unknown')
    assert.equal(unknown.sameSessionResume, 'unknown')
    assert.equal(unknown.crossModelContext, 'cross_model_unavailable')
})

test('第二 Provider 不把同模型重连宣称为缓存命中', () => {
    for (const url of ['https://api.deepseek.com/anthropic', 'https://opencode.example.test/v1']) {
        const profile = resolveProviderCapabilityProfile(url)
        assert.notEqual(profile.cacheUsage, 'cache_hit')
        assert.equal(profile.crossModelContext, 'cross_model_unavailable')
    }
})
