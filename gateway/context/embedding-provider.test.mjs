import assert from 'node:assert/strict'
import test from 'node:test'
import {createEmbeddingProvider} from './embedding-provider.mjs'

test('embedding provider 使用参数化请求并校验维度', async () => {
    let request
    const provider = createEmbeddingProvider({
        endpoint: 'http://127.0.0.1:9999/v1/embeddings', apiKey: 'secret', model: 'local-model', dimensions: 3,
        fetchImpl: async (url, options) => {
            request = {url, options}
            return {ok: true, json: async () => ({data: [{embedding: [0.1, 0.2, 0.3]}]})}
        },
    })
    assert.deepEqual(await provider.embed('编码约定'), [0.1, 0.2, 0.3])
    assert.equal(request.url, 'http://127.0.0.1:9999/v1/embeddings')
    assert.equal(JSON.parse(request.options.body).input, '编码约定')
    assert.equal(request.options.headers.authorization, 'Bearer secret')
    provider.close()
    await assert.rejects(() => provider.embed('x'), error => error.code === 'EMBEDDING_PROVIDER_CLOSED')
})

test('未配置 endpoint、HTTP 错误、维度错误和取消均返回稳定错误', async () => {
    const missing = createEmbeddingProvider({dimensions: 2, fetchImpl: async () => ({})})
    await assert.rejects(() => missing.embed('x'), error => error.code === 'EMBEDDING_ENDPOINT_MISSING')
    const bad = createEmbeddingProvider({endpoint: 'http://127.0.0.1:9999', dimensions: 2, fetchImpl: async () => ({ok: true, json: async () => ({data: [{embedding: [1]}]})})})
    await assert.rejects(() => bad.embed('x'), error => error.code === 'EMBEDDING_RESPONSE_INVALID')
    const failed = createEmbeddingProvider({endpoint: 'http://127.0.0.1:9999', dimensions: 2, fetchImpl: async () => ({ok: false, status: 429})})
    await assert.rejects(() => failed.embed('x'), error => error.code === 'EMBEDDING_RATE_LIMITED')
    const controller = new AbortController(); controller.abort()
    const cancelled = createEmbeddingProvider({endpoint: 'http://127.0.0.1:9999', dimensions: 2, fetchImpl: async () => { const e = new Error(); e.name = 'AbortError'; throw e }})
    await assert.rejects(() => cancelled.embed('x', {signal: controller.signal}), error => error.code === 'EMBEDDING_ABORTED')
})
