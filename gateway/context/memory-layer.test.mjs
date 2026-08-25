import assert from 'node:assert/strict'
import test from 'node:test'
import {deriveMemoryLayers, memoryTier, normalizeMemoryMetadata, selectMemoryContent} from './memory-layer.mjs'

test('Memory 元数据预留层级、类型和摘要字段', () => {
    const result = normalizeMemoryMetadata({memoryType: 'decision', parentKey: 'architecture'}, '# 采用 PostgreSQL。\n\n不要记录 apiKey=secret-value。')
    assert.equal(result.schemaVersion, 1)
    assert.equal(result.memoryType, 'decision')
    assert.equal(result.parentKey, 'architecture')
    assert.match(result.l0, /采用 PostgreSQL/)
    assert.doesNotMatch(`${result.l0} ${result.l1}`, /secret-value/)
    assert.equal(result.summaryGenerator, 'deterministic-v1')
})

test('摘要字段有界且支持按层读取', () => {
    const body = '第一句。' + '很长的正文。'.repeat(1000)
    const metadata = normalizeMemoryMetadata({}, body)
    const row = {body, metadata}
    assert.equal(deriveMemoryLayers(body).l0, '第一句。')
    assert.ok(metadata.l0.length <= 240)
    assert.ok(metadata.l1.length <= 1600)
    assert.equal(memoryTier(row, 'l0'), 'l0')
    assert.equal(selectMemoryContent(row, 'l0').content, '第一句。')
    assert.equal(selectMemoryContent(row, 'l2').content, body)
})

test('旧记录没有摘要时仍回退到正文层', () => {
    const row = {body: '旧正文', metadata: {}}
    assert.equal(memoryTier(row), 'l2')
    assert.deepEqual(selectMemoryContent(row), {tier: 'l2', content: '旧正文'})
})
