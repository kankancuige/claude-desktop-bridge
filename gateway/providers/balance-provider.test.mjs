import test from 'node:test'
import assert from 'node:assert/strict'
import {parseDeepSeekBalance, resolveBalanceProvider} from './balance-provider.mjs'

test('only DeepSeek enables the fixed DeepSeek balance endpoint', () => {
    assert.deepEqual(resolveBalanceProvider('https://api.deepseek.com/anthropic'), {
        id: 'deepseek',
        supported: true,
        endpoint: 'https://api.deepseek.com/user/balance',
    })
})

test('local CCSwitch proxy is reported as unsupported instead of queried as DeepSeek', () => {
    const result = resolveBalanceProvider('http://127.0.0.1:15721')
    assert.equal(result.id, 'local-proxy')
    assert.equal(result.supported, false)
    assert.equal(result.reason, 'local_proxy')
})

test('Codex relay does not reuse DeepSeek balance semantics', () => {
    const result = resolveBalanceProvider('https://api.claudecode.net.cn/api/codex/backend-api/codex')
    assert.equal(result.id, 'codex-relay')
    assert.equal(result.supported, false)
    assert.equal(result.endpoint, undefined)
})

test('missing and custom providers are safe optional states', () => {
    assert.equal(resolveBalanceProvider('').supported, false)
    assert.equal(resolveBalanceProvider('https://example.invalid/v1').reason, 'provider_unsupported')
})

test('DeepSeek balance payload is normalized defensively', () => {
    assert.deepEqual(parseDeepSeekBalance({balance_infos: [{total_balance: '12.50', currency: 'CNY'}]}), {
        balance: 12.5,
        currency: 'CNY',
    })
    assert.deepEqual(parseDeepSeekBalance({}), {balance: 0, currency: 'CNY'})
})
