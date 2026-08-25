import assert from 'node:assert/strict'
import test from 'node:test'
import {contentHash, createPostgresContentStore} from './postgres-content-store.mjs'

function fakeGateway() {
    const calls = []
    return {calls, query: async (text, values) => {
        calls.push({text, values})
        if (text.includes('SELECT project_key') && text.includes('ORDER BY version')) return {rows: []}
        if (text.includes('RETURNING')) return {rows: [{projectKey: values[0], kind: values[1], sourceKey: values[2], body: values[4], version: values[6], metadata: {}}]}
        return {rows: [], rowCount: 1}
    }}
}

function idempotentGateway() {
    const calls = []
    return {calls, query: async (text, values) => {
        calls.push({text, values})
        if (text.includes('ORDER BY version')) return {rows: [{bodyHash: 'hash', body: 'same', version: 1, createdAt: 1}]}
        return {rows: [], rowCount: 1}
    }}
}

function repairGateway() {
    const calls = []
    return {calls, query: async (text, values) => {
        calls.push({text, values})
        if (text.includes('ORDER BY version')) return {rows: [{bodyHash: 'hash', body: null, version: 1, createdAt: 1}]}
        if (text.startsWith('UPDATE')) return {rows: [{body: values[3], bodyHash: 'hash', version: 1}]}
        return {rows: [], rowCount: 1}
    }}
}

test('Markdown 内容通过统一入口版本化保存，不拼接用户 SQL', async () => {
    const gateway = fakeGateway()
    const store = createPostgresContentStore({gateway})
    const result = await store.put({projectKey: 'D--demo', kind: 'markdown', sourceKey: 'memory/rules.md', body: '# 规则'})
    assert.equal(result.version, 1)
    assert.equal(gateway.calls.length, 2)
    assert.ok(gateway.calls[1].values.includes(contentHash('# 规则')))
    assert.doesNotMatch(gateway.calls[1].text, /# 规则/)
})

test('不允许跨项目或不支持的内容类型', async () => {
    const store = createPostgresContentStore({gateway: fakeGateway()})
    await assert.rejects(() => store.put({projectKey: '', kind: 'markdown', sourceKey: 'x', body: 'x'}), error => error.code === 'STORAGE_CONTENT_KEY_INVALID')
    await assert.rejects(() => store.put({projectKey: 'p', kind: 'secret', sourceKey: 'x', body: 'x'}), error => error.code === 'STORAGE_CONTENT_KIND_INVALID')
})

test('相同 body hash 重复写入保持幂等，不创建新版本', async () => {
    const gateway = idempotentGateway()
    const store = createPostgresContentStore({gateway})
    const result = await store.put({projectKey: 'p', kind: 'markdown', sourceKey: 'memory/rules.md', body: 'same', bodyHash: 'hash'})
    assert.equal(result.version, 1)
    assert.equal(gateway.calls.length, 1)
})

test('相同 hash 但正文缺失时补齐正文，不创建新版本', async () => {
    const gateway = repairGateway()
    const store = createPostgresContentStore({gateway})
    const result = await store.put({projectKey: 'p', kind: 'memory', sourceKey: 'memory/rules.md', body: 'restored', bodyHash: 'hash'})
    assert.equal(result.version, 1)
    assert.equal(result.body, 'restored')
    assert.equal(gateway.calls.length, 2)
})

test('内容列表返回正文，供统一 Memory 入口生成注入文本', async () => {
    const gateway = fakeGateway()
    const store = createPostgresContentStore({gateway})
    await store.list({projectKey: 'p', kind: 'memory', status: 'active', limit: 10})
    const listQuery = gateway.calls.find(call => call.text.includes('ORDER BY updated_at DESC'))
    assert.match(listQuery.text, /title, body, body_hash/)
})

test('内容列表支持 updated_at/source_key keyset 游标', async () => {
    const gateway = fakeGateway()
    const store = createPostgresContentStore({gateway})
    await store.list({projectKey: 'p', kind: 'memory', status: 'active', limit: 10, after: {updatedAt: 123, sourceKey: 'memory/old.md'}})
    const call = gateway.calls.at(-1)
    assert.match(call.text, /\(updated_at, source_key\) < \(\$4, \$5\)/)
    assert.deepEqual(call.values.slice(-3), [123, 'memory/old.md', 10])
})

test('Memory 子节点查询使用 JSONB parentKey 和参数化 keyset', async () => {
    const gateway = fakeGateway()
    const store = createPostgresContentStore({gateway})
    await store.listChildren({projectKey: 'p', parentKey: 'memory/root.md', limit: 5, after: {updatedAt: 123, sourceKey: 'memory/old.md'}})
    const call = gateway.calls.at(-1)
    assert.match(call.text, /metadata->>'parentKey' = \$3/)
    assert.match(call.text, /\(updated_at, source_key\) < \(\$5, \$6\)/)
    assert.deepEqual(call.values.slice(-3), [123, 'memory/old.md', 5])
})

test('Memory load 按层返回摘要并兼容旧正文', async () => {
    const store = createPostgresContentStore({gateway: {query: async (text) => text.includes('ORDER BY version') ? {rows: [{body: '正文', metadata: {l0: '摘要', l1: '概览'}}]} : {rows: []}}})
    const result = await store.load({projectKey: 'p', sourceKey: 'memory/a.md', tier: 'l0'})
    assert.equal(result.selectedTier, 'l0')
    assert.equal(result.selectedBody, '摘要')
})

test('按正文 hash 和 embedding model 查询现有向量', async () => {
    const gateway = {calls: [], query: async (text, values) => { gateway.calls.push({text, values}); return {rows: [{status: 'ready', embeddingModel: values[3]}]} }}
    const store = createPostgresContentStore({gateway})
    const result = await store.getEmbedding({projectKey: 'p', sourceKey: 'memory/a.md', bodyHash: 'h', embeddingModel: 'm'})
    assert.equal(result.status, 'ready')
    assert.deepEqual(gateway.calls[0].values, ['p', 'memory/a.md', 'h', 'm'])
})

test('向量写入和相似召回使用参数化 vector 查询', async () => {
    const gateway = fakeGateway()
    const store = createPostgresContentStore({gateway})
    await store.putEmbedding({projectKey: 'p', sourceKey: 'memory/rules.md', bodyHash: 'h', embeddingModel: 'local', embedding: [0.1, 0.2]})
    await store.searchSimilar({projectKey: 'p', embeddingModel: 'local', embedding: [0.1, 0.2], limit: 5})
    const writes = gateway.calls.filter(call => call.text.includes('memory_embeddings'))
    assert.equal(writes.length, 2)
    assert.match(writes[0].text, /\$7::vector/)
    assert.deepEqual(writes[0].values[6], '[0.1,0.2]')
    assert.equal(writes[1].values[2], 'local')
})
