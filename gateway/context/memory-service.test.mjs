import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, unlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {createPostgresStateFixture} from '../test-support/postgres-state-fixture.mjs'
import {createMemoryService} from './memory-service.mjs'

function syncMemoryRepository(store) {
    return {
        list: ({projectKey, status = 'active', limit = 100} = {}) => store.listMemoryIndex(projectKey, {status, limit}),
        get: ({projectKey, sourceKey} = {}) => store.listMemoryIndex(projectKey, {status: null, limit: 500}).find(row => row.sourcePath === sourceKey) || null,
        put: ({projectKey, sourceKey, title, body, bodyHash, scope, status, metadata, updatedAt} = {}) => store.upsertMemoryIndex({projectKey, sourcePath: sourceKey, title, body, contentHash: bodyHash, scope, status, keywords: metadata?.keywords || '', mtime: metadata?.mtime || 0, size: metadata?.size || Buffer.byteLength(body || ''), confidence: metadata?.confidence ?? 1, lastVerifiedAt: metadata?.lastVerifiedAt || null, updatedAt}),
        disable: ({projectKey, sourceKey, updatedAt} = {}) => store.upsertMemoryIndex({...syncMemoryRepository(store).get({projectKey, sourceKey}), projectKey, sourcePath: sourceKey, status: 'disabled', updatedAt}),
        remove: ({projectKey, sourceKey} = {}) => store.removeMemoryIndex(projectKey, sourceKey),
        markUsed: ({projectKey, sourceKey, usedAt} = {}) => store.markMemoryUsed(projectKey, sourceKey, usedAt),
    }
}

function fixture() {
    const home = mkdtempSync(join(tmpdir(), 'bridge-memory-'))
    const encodedDir = 'D--demo'
    mkdirSync(join(home, 'projects', encodedDir, 'memory'), {recursive: true})
    writeFileSync(join(home, 'projects', encodedDir, 'memory', 'conventions.md'), '# 编码约定\n所有源文件使用 UTF-8，注释使用简体中文。\napi_key=should-not-leak\n', 'utf8')
    const {store} = createPostgresStateFixture()
    const service = createMemoryService({bridgeHome: home, memoryRepository: syncMemoryRepository(store)})
    return {home, db: store, service, encodedDir}
}

test('普通问题不召回 Memory，动作任务只召回关键词匹配内容并脱敏', t => {
    const {db, service, encodedDir} = fixture()
    t.after(() => db.close())
    assert.equal(service.retrieve({workDir: 'D:\\demo', encodedDir, text: '你好，什么是 UTF-8？'}).text, '')
    const result = service.retrieve({workDir: 'D:\\demo', encodedDir, text: '修改代码并统一使用 UTF-8 编码'})
    assert.match(result.text, /编码约定/)
    assert.match(result.text, /UTF-8/)
    assert.doesNotMatch(result.text, /should-not-leak/)
    assert.equal(result.items.length, 1)
    assert.equal(service.retrieve({workDir: 'D:\\demo', encodedDir, text: '修改中文注释'}).items.length, 1)
})

test('Memory 索引刷新可处理删除和禁用', t => {
    const {home, db, service, encodedDir} = fixture()
    t.after(() => db.close())
    service.refreshProject({workDir: 'D:\\demo', encodedDir})
    assert.equal(service.list({encodedDir}).length, 1)
    assert.equal(service.disable({encodedDir, sourcePath: 'memory/conventions.md'}), true)
    assert.equal(service.retrieve({workDir: 'D:\\demo', encodedDir, text: '修改代码并使用 UTF-8'}).items.length, 0)
    assert.equal(service.list({encodedDir, status: null})[0].status, 'disabled')
    assert.equal(service.setEnabled({encodedDir, sourcePath: 'memory/conventions.md', enabled: true}), true)
    assert.equal(service.list({encodedDir, query: 'UTF-8'}).length, 1)
    assert.equal(service.retrieve({workDir: 'D:\\demo', encodedDir, text: '修改代码并使用 UTF-8'}).items.length, 1)
    assert.ok(service.list({encodedDir})[0].lastUsedAt)
    unlinkSync(join(home, 'projects', encodedDir, 'memory', 'conventions.md'))
    const refreshed = service.refreshProject({workDir: 'D:\\demo', encodedDir})
    assert.equal(refreshed.removed, 1)
    assert.deepEqual(service.list({encodedDir}), [])
})

test('异步 Memory 刷新保留 candidate 和已审批数据库 Memory', async t => {
    const {home, db, encodedDir} = fixture()
    t.after(() => db.close())
    const rows = new Map()
    const repository = {
        async list({projectKey, status, limit = 100} = {}) { return [...rows.values()].filter(row => row.projectKey === projectKey && (!status || row.status === status)).slice(0, limit) },
        async get({projectKey, sourceKey}) { return rows.get(`${projectKey}:${sourceKey}`) || null },
        async put(value) { const row = {...value, metadata: {...(value.metadata || {})}}; rows.set(`${row.projectKey}:${row.sourceKey}`, row); return row },
        async disable({projectKey, sourceKey}) { const row = rows.get(`${projectKey}:${sourceKey}`); if (!row) return false; row.status = 'disabled'; return true },
        async remove({projectKey, sourceKey}) { return rows.delete(`${projectKey}:${sourceKey}`) },
        async markUsed() { return true },
    }
    await repository.put({projectKey: encodedDir, sourceKey: 'candidate/c1', title: '候选规则', body: '候选规则', status: 'candidate', metadata: {lifecycle: 'candidate'}})
    await repository.put({projectKey: encodedDir, sourceKey: 'memory/approved-c1.md', title: '已审批规则', body: '已审批规则', status: 'active', metadata: {lifecycle: 'active', approvedBy: 'user'}})
    const service = createMemoryService({bridgeHome: home, memoryRepository: repository})
    const refreshed = await service.refreshProjectAsync({workDir: 'D:\\demo', encodedDir})
    assert.equal(refreshed.removed, 0)
    const persisted = await repository.list({projectKey: encodedDir, status: null})
    assert.equal(persisted.some(row => row.sourceKey === 'candidate/c1' && row.status === 'candidate'), true)
    assert.equal(persisted.some(row => row.sourceKey === 'memory/approved-c1.md' && row.status === 'active'), true)
})

test('Memory 索引支持重建和显式删除', t => {
    const {db, service, encodedDir} = fixture()
    t.after(() => db.close())
    service.refreshProject({workDir: 'D:\\demo', encodedDir})
    service.disable({encodedDir, sourcePath: 'memory/conventions.md'})
    assert.equal(service.rebuild({workDir: 'D:\\demo', encodedDir}).indexed, 1)
    assert.equal(service.list({encodedDir})[0].status, 'disabled')
    assert.equal(service.remove({encodedDir, sourcePath: 'memory/conventions.md'}), true)
    assert.deepEqual(service.list({encodedDir}), [])
    assert.equal(service.refreshProject({workDir: 'D:\\demo', encodedDir}).indexed, 1)
})

test('明确不要记忆时不注入', t => {
    const {db, service, encodedDir} = fixture()
    t.after(() => db.close())
    const result = service.retrieve({workDir: 'D:\\demo', encodedDir, text: '修改代码，但不要记住这次使用 UTF-8'})
    assert.equal(result.text, '')
})

test('本轮明确覆盖项目约定时不召回冲突 Memory', t => {
    const {db, service, encodedDir} = fixture()
    t.after(() => db.close())
    const result = service.retrieve({workDir: 'D:\\demo', encodedDir, text: '修改代码，这次不要使用 UTF-8，改用 GBK'})
    assert.equal(result.text, '')
    assert.deepEqual(result.items, [])
})

test('Memory 注入按 UTF-8 字节限制总大小并脱敏常见凭据格式', t => {
    const {home, db, encodedDir} = fixture()
    t.after(() => db.close())
    writeFileSync(join(home, 'projects', encodedDir, 'memory', 'secrets.md'), [
        '# 中文约定',
        '"apiKey": "json-secret-value"',
        'Authorization: Bearer bearer-secret-value',
        'token: plain-token-value',
        'token: sk-1234567890abcdef',
        '-----BEGIN PRIVATE KEY-----',
        'private-secret-value',
        '-----END PRIVATE KEY-----',
        '修改代码时保留中文说明。'.repeat(600),
    ].join('\n'), 'utf8')
    const service = createMemoryService({bridgeHome: home, memoryRepository: syncMemoryRepository(db), maxBytes: 1024})
    const result = service.retrieve({workDir: 'D:\\demo', encodedDir, text: '修改代码并保留中文约定'})
    assert.ok(Buffer.byteLength(result.text, 'utf8') <= 1024)
    assert.doesNotMatch(result.text, /json-secret-value|bearer-secret-value|plain-token-value|1234567890abcdef|private-secret-value/)
})

test('Memory 作用域默认隔离，Agent/Task 只接受匹配身份并返回检索轨迹', t => {
    const {home, db, encodedDir} = fixture()
    t.after(() => db.close())
    const rows = [
        {sourceKey: 'memory/project.md', sourcePath: 'memory/project.md', title: '项目', body: '统一 UTF-8', scope: 'project', status: 'active', metadata: {keywords: 'utf-8'}},
        {sourceKey: 'memory/agent.md', sourcePath: 'memory/agent.md', title: 'Agent', body: 'Agent UTF-8', scope: 'agent', status: 'active', metadata: {keywords: 'utf-8', agentType: 'reviewer'}},
        {sourceKey: 'memory/task.md', sourcePath: 'memory/task.md', title: 'Task', body: 'Task UTF-8', scope: 'task', status: 'active', metadata: {keywords: 'utf-8', taskId: 'task-1'}},
    ]
    const repository = {list: async () => rows, get: async () => null, put: async row => row, disable: async () => true, remove: async () => true, markUsed: async () => true}
    const service = createMemoryService({bridgeHome: home, memoryRepository: repository})
    return service.retrieveAsync({workDir: 'D:\\demo', encodedDir, text: '修改代码并统一 UTF-8', scope: 'agent', agentType: 'reviewer'}).then(result => {
        assert.deepEqual(result.items.map(item => item.sourcePath), ['memory/agent.md'])
        assert.equal(result.trace[0].selected, true)
        return service.retrieveAsync({workDir: 'D:\\demo', encodedDir, text: '修改代码并统一 UTF-8', scope: 'task', taskId: 'other'})
    }).then(result => assert.equal(result.items.length, 0))
})

test('PostgreSQL 内容入口可同步 Memory 正文并召回', async t => {
    const {home, db, encodedDir} = fixture()
    t.after(() => db.close())
    const rows = []
    const memoryRepository = {
            put: async row => {
                rows.push({
                    projectKey: row.projectKey,
                    sourceKey: row.sourceKey,
                    title: row.title,
                    body: row.body,
                    bodyHash: row.bodyHash,
                    metadata: row.metadata,
                    status: row.status,
                    updatedAt: row.updatedAt,
                })
                return row
            },
            list: async () => rows,
            get: async () => rows[0] || null,
            disable: async () => true,
            remove: async () => true,
            markUsed: async () => true,
    }
    const service = createMemoryService({bridgeHome: home, memoryRepository})
    const result = await service.retrieveAsync({workDir: 'D:\\demo', encodedDir, text: '修改代码并统一使用 UTF-8 编码'})
    assert.match(result.text, /编码约定/)
    assert.equal(result.backend, 'postgres')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].sourceKey, 'memory/conventions.md')
})

test('PostgreSQL Memory 管理操作更新统一内容入口', async t => {
    const {home, db, encodedDir} = fixture()
    t.after(() => db.close())
    const rows = []
    const memoryRepository = {
            put: async row => {
                const existing = rows.find(item => item.sourceKey === row.sourceKey)
                if (existing) Object.assign(existing, row)
                else rows.push({...row})
                return row
            },
            list: async () => rows,
            get: async ({sourceKey}) => rows.find(item => item.sourceKey === sourceKey) || null,
            disable: async ({sourceKey}) => {
                const row = rows.find(item => item.sourceKey === sourceKey)
                if (row) row.status = 'disabled'
                return Boolean(row)
            },
            remove: async ({sourceKey}) => {
                const index = rows.findIndex(item => item.sourceKey === sourceKey)
                if (index < 0) return false
                rows.splice(index, 1)
                return true
            },
            markUsed: async () => true,
    }
    const service = createMemoryService({bridgeHome: home, memoryRepository})
    await service.refreshProjectAsync({workDir: 'D:\\demo', encodedDir})
    assert.equal((await service.listAsync({encodedDir}))[0].status, 'active')
    assert.equal(await service.setEnabledAsync({encodedDir, sourcePath: 'memory/conventions.md', enabled: false}), true)
    assert.equal((await service.listAsync({encodedDir}))[0].status, 'disabled')
    assert.equal(await service.setEnabledAsync({encodedDir, sourcePath: 'memory/conventions.md', enabled: true}), true)
    assert.equal(await service.removeAsync({encodedDir, sourcePath: 'memory/conventions.md'}), true)
    assert.deepEqual(await service.listAsync({encodedDir}), [])
})

test('Memory 规模策略提供诊断且不改变默认召回路径', async t => {
    const {db, service, encodedDir} = fixture()
    t.after(() => db.close())
    const policy = await service.scalePolicyAsync({encodedDir})
    assert.equal(policy.mode, 'flat')
    assert.equal(policy.shouldUseHierarchy, false)
    await service.refreshProjectAsync({workDir: 'D:\\demo', encodedDir})
    const loaded = await service.loadAsync({encodedDir, sourcePath: 'memory/conventions.md', tier: 'l0'})
    assert.equal(loaded.selectedTier, 'l0')
    assert.equal(typeof loaded.selectedBody, 'string')
})

test('pgvector 语义召回在 embedding provider 和向量索引可用时启用', async t => {
    const {home, db, encodedDir} = fixture()
    t.after(() => db.close())
    const rows = []
    const memoryRepository = {
            put: async row => { rows.push({...row}); return row },
            putEmbedding: async () => ({status: 'ready'}),
            list: async () => rows,
            get: async () => rows[0] || null,
            searchSimilar: async () => [{sourceKey: 'memory/conventions.md', title: '编码约定', body: '# 编码约定\n统一使用 UTF-8。', metadata: {keywords: 'UTF-8 编码'}, similarity: 0.98}],
            disable: async () => true,
            remove: async () => true,
            markUsed: async () => true,
    }
    const service = createMemoryService({
        bridgeHome: home, memoryRepository, vectorEnabled: true,
        embeddingProvider: {name: 'fake-embedding', embed: async () => [1, 0]},
    })
    const result = await service.retrieveAsync({workDir: 'D:\\demo', encodedDir, text: '修改代码并统一使用 UTF-8 编码'})
    assert.equal(result.backend, 'postgres-pgvector')
    assert.equal(result.items[0].score, 0.98)
    assert.match(result.text, /统一使用 UTF-8/)
})
