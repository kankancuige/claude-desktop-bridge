import test from 'node:test'
import assert from 'node:assert/strict'
import {
    resolveProviderRedirect,
    validateProviderUrl,
    createPinnedLookup,
} from './provider-url-security.mjs'

test('供应商 URL 拒绝凭据和默认禁用的本地地址', async () => {
    await assert.rejects(() => validateProviderUrl('https://user:pass@example.com/v1'))
    await assert.rejects(() => validateProviderUrl('http://127.0.0.1:8080/v1'))
    await assert.rejects(() => validateProviderUrl('http://[::ffff:127.0.0.1]/v1'))
    assert.equal((await validateProviderUrl('http://127.0.0.1:8080/v1', {allowLocal: true})).hostname, '127.0.0.1')
})

test('Node all lookup 请求返回地址数组，普通请求返回单地址', () => {
    const lookup = createPinnedLookup('203.0.113.10', 4)
    lookup('provider.example', {all: true}, (error, addresses) => {
        assert.equal(error, null)
        assert.deepEqual(addresses, [{address: '203.0.113.10', family: 4}])
    })
    lookup('provider.example', {all: false}, (error, address, family) => {
        assert.equal(error, null)
        assert.equal(address, '203.0.113.10')
        assert.equal(family, 4)
    })
})

test('供应商重定向仅允许保持同一 origin', () => {
    assert.equal(
        resolveProviderRedirect('https://api.example.com/v1/models', '../v2/models'),
        'https://api.example.com/v2/models',
    )
    assert.throws(
        () => resolveProviderRedirect('https://api.example.com/v1/models', 'https://evil.example/v1/models'),
        /cross-origin/,
    )
    assert.throws(
        () => resolveProviderRedirect('https://api.example.com/v1/models', 'http://api.example.com/v1/models'),
        /cross-origin/,
    )
})
