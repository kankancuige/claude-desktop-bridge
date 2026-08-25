import assert from 'node:assert/strict'
import test from 'node:test'
import {runMemoryLayerBackfill} from './memory-layer-backfill.mjs'

function repository(rows) {
    const writes = []
    return {
        writes,
        async list({after = null, limit = 25} = {}) {
            const start = after ? rows.findIndex(row => row.sourceKey === after.sourceKey) + 1 : 0
            return rows.slice(Math.max(0, start), start + limit)
        },
        async put(row) { writes.push(row); return row },
    }
}

test('摘要回填支持批次、幂等和 dry-run', async () => {
    const rows = [
        {sourceKey: 'memory/a.md', body: '第一条。正文', bodyHash: 'a', updatedAt: 3, metadata: {}},
        {sourceKey: 'memory/b.md', body: '第二条。正文', bodyHash: 'b', updatedAt: 2, metadata: {l0: '已有', l1: '已有概览', summaryBodyHash: 'b'}},
    ]
    const repo = repository(rows)
    const result = await runMemoryLayerBackfill({memoryRepository: repo, projectKey: 'p', batchSize: 1, dryRun: true})
    assert.equal(result.status, 'completed')
    assert.equal(result.updated, 1)
    assert.equal(result.skipped, 1)
    assert.equal(repo.writes.length, 0)
})

test('摘要回填支持自定义摘要、断点和取消', async () => {
    const rows = [{sourceKey: 'memory/a.md', body: '正文', bodyHash: 'a', updatedAt: 3, metadata: {}}]
    const repo = repository(rows)
    const controller = new AbortController()
    const result = await runMemoryLayerBackfill({memoryRepository: repo, projectKey: 'p', summarize: async () => { controller.abort(); return {l0: '摘要', l1: '概览', memoryType: 'decision'} } , signal: controller.signal})
    assert.equal(result.status, 'cancelled')
    assert.equal(result.scanned, 1)
    assert.equal(result.updated, 0)
})

test('摘要回填失败返回可重试断点并不吞掉错误', async () => {
    const repo = repository([{sourceKey: 'memory/a.md', body: '正文', bodyHash: 'a', updatedAt: 3, metadata: {}}])
    const result = await runMemoryLayerBackfill({memoryRepository: repo, projectKey: 'p', summarize: async () => { throw Object.assign(new Error('模型失败'), {code: 'MODEL_FAILED'}) }})
    assert.equal(result.status, 'failed')
    assert.equal(result.nextCheckpoint, null)
    assert.equal(result.failures[0].code, 'MODEL_FAILED')
})
