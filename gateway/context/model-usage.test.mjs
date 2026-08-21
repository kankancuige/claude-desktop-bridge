import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createModelUsageEvent, normalizeProviderUsage} from './model-usage.mjs'

const gatewaySource = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')

test('Provider usage 保留实际 cache 字段，并把缺失字段标为 partial 而非零', () => {
    assert.deepEqual(normalizeProviderUsage({
        input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 7, cache_creation_input_tokens: 3,
    }), {
        inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 7, cacheCreationInputTokens: 3,
        source: 'provider_observed',
    })
    assert.deepEqual(normalizeProviderUsage({input_tokens: 10, output_tokens: 2}), {
        inputTokens: 10, outputTokens: 2, cacheReadInputTokens: null, cacheCreationInputTokens: null,
        source: 'partial',
    })
})

test('未知、非法和不完整 usage 不会伪造为可计费用量', () => {
    assert.deepEqual(normalizeProviderUsage({input_tokens: -1, output_tokens: 'bad'}), {
        inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null,
        source: 'unknown',
    })
    assert.equal(normalizeProviderUsage({inputTokens: 4, outputTokens: 1}).source, 'partial')
})

test('usage event 只包含脱敏 envelope 投影，不包含 Prompt、凭据或原始路径', () => {
    const event = createModelUsageEvent({
        eventId: 'usage-1', sessionId: 'session-1', projectKey: 'D--project', durationMs: 44, retryCount: 1,
        policy: {mode: 'rebuild_full_history', cacheEligibility: 'unknown', reasonCodes: ['rules_changed']},
        envelope: {providerKey: 'sha256:1234', model: 'model-balanced', fingerprint: 'sha256:abcd', prompt: 'secret prompt', rawPath: 'D:/private'},
        usage: {input_tokens: 10, output_tokens: 2},
    })
    assert.equal(event.source, 'partial')
    assert.equal(event.cacheReadInputTokens, null)
    assert.equal(event.model, 'model-balanced')
    assert.doesNotMatch(JSON.stringify(event), /secret|private|rawPath/i)
})

test('Gateway 仅在 SDK result 上创建脱敏 usage ledger 事件', () => {
    const resultBranch = gatewaySource.slice(gatewaySource.indexOf("if (sdkMsg.type === 'result'"), gatewaySource.indexOf("if (sdkMsg.type === 'result') s._generating = false"))
    assert.match(resultBranch, /recordProviderUsage\(sessionId, s, sdkMsg\)/)
    assert.match(gatewaySource, /appendModelUsageEvent\(event\)/)
    assert.doesNotMatch(gatewaySource.slice(gatewaySource.indexOf('function recordProviderUsage'), gatewaySource.indexOf('function maybeRefreshContextUsage')), /prompt|apiKey|rawPath/i)
})
