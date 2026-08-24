import assert from 'node:assert/strict'
import test from 'node:test'
import {runMemoryEmbeddingBackfill} from './memory-embedding-backfill.mjs'

function store(rows, embeddings = new Map()) {
    const calls = {list: [], get: [], put: []}
    return {
        calls,
        async list(args) {
            calls.list.push(args)
            const start = args.after ? rows.findIndex(row => row.sourceKey === args.after.sourceKey) + 1 : 0
            return rows.slice(start, start + args.limit)
        },
        async getEmbedding(args) {
            calls.get.push(args)
            return embeddings.get(`${args.sourceKey}:${args.bodyHash}:${args.embeddingModel}`) || null
        },
        async putEmbedding(args) {
            calls.put.push(args)
            embeddings.set(`${args.sourceKey}:${args.bodyHash}:${args.embeddingModel}`, {status: 'ready'})
            return args
        },
    }
}

const rows = [
    {sourceKey: 'memory/a.md', bodyHash: 'ha', body: 'A', updatedAt: 3},
    {sourceKey: 'memory/b.md', bodyHash: 'hb', body: 'B', updatedAt: 2},
    {sourceKey: 'memory/c.md', bodyHash: 'hc', body: 'C', updatedAt: 1},
]

test('dry-run 只统计，不调用 provider 或写入向量', async () => {
    const repository = store(rows)
    let calls = 0
    const result = await runMemoryEmbeddingBackfill({contentStore: repository, projectKey: 'p', embeddingModel: 'm', dryRun: true, embeddingProvider: {embed: async () => { calls++ }}, batchSize: 2})
    assert.equal(result.status, 'completed')
    assert.equal(result.eligible, 3)
    assert.equal(result.embedded, 0)
    assert.equal(calls, 0)
    assert.equal(repository.calls.put.length, 0)
    assert.equal(repository.calls.list.length, 2)
})

test('按正文 hash 和模型幂等跳过，checkpoint 可续跑', async () => {
    const repository = store(rows, new Map([['memory/a.md:ha:m', {status: 'ready'}]]))
    const embedded = []
    const result = await runMemoryEmbeddingBackfill({contentStore: repository, projectKey: 'p', embeddingModel: 'm', embeddingProvider: {embed: async body => { embedded.push(body); return [1, 0] }}, batchSize: 1, checkpoint: {updatedAt: 3, sourceKey: 'memory/a.md'}})
    assert.equal(result.embedded, 2)
    assert.equal(result.skipped, 0)
    assert.deepEqual(embedded, ['B', 'C'])
    assert.deepEqual(result.nextCheckpoint, {updatedAt: 1, sourceKey: 'memory/c.md'})
})

test('429 和 5xx 有限重试，耗尽后记录失败且不伪造成功', async () => {
    const repository = store([rows[0]])
    let attempts = 0
    const result = await runMemoryEmbeddingBackfill({contentStore: repository, projectKey: 'p', embeddingModel: 'm', embeddingProvider: {embed: async () => { attempts++; throw Object.assign(new Error('busy'), {code: attempts === 1 ? 'EMBEDDING_RATE_LIMITED' : 'EMBEDDING_HTTP_FAILED'}) }}, retry: {attempts: 2, baseDelayMs: 0, maxDelayMs: 0}})
    assert.equal(attempts, 2)
    assert.equal(result.status, 'failed')
    assert.equal(result.failed, 1)
    assert.equal(result.embedded, 0)
    assert.equal(result.failures[0].code, 'EMBEDDING_HTTP_FAILED')
})

test('取消会返回 cancelled 和可续跑游标，不吞掉取消状态', async () => {
    const repository = store(rows)
    const controller = new AbortController()
    const result = await runMemoryEmbeddingBackfill({contentStore: repository, projectKey: 'p', embeddingModel: 'm', embeddingProvider: {embed: async () => { controller.abort(); throw Object.assign(new Error('cancelled'), {code: 'EMBEDDING_ABORTED'}) }}, signal: controller.signal})
    assert.equal(result.status, 'cancelled')
    assert.equal(result.cancelled, true)
    assert.deepEqual(result.nextCheckpoint, {updatedAt: 3, sourceKey: 'memory/a.md'})
})

test('缺少 provider 时拒绝启动正式回填', async () => {
    const repository = store(rows)
    await assert.rejects(() => runMemoryEmbeddingBackfill({contentStore: repository, projectKey: 'p', embeddingModel: 'm'}), error => error.code === 'MEMORY_BACKFILL_PROVIDER_REQUIRED')
})
