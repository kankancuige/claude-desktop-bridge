import assert from 'node:assert/strict'
import {existsSync, mkdtempSync, mkdirSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {createPostgresStateFixture} from '../test-support/postgres-state-fixture.mjs'
import {createMemoryService} from './memory-service.mjs'
import {
    deleteProjectMemory,
    listProjectMemory,
    listProjectMemoryAsync,
    rebuildProjectMemory,
    saveProjectMemory,
    setProjectMemoryEnabled,
} from './memory-admin.mjs'

function syncMemoryRepository(store) {
    return {
        list: ({projectKey, status = 'active', limit = 100} = {}) => store.listMemoryIndex(projectKey, {status, limit}),
        get: ({projectKey, sourceKey} = {}) => store.listMemoryIndex(projectKey, {status: null, limit: 500}).find(row => row.sourcePath === sourceKey) || null,
        put: ({projectKey, sourceKey, title, body, bodyHash, scope, status, metadata, updatedAt} = {}) => store.upsertMemoryIndex({projectKey, sourcePath: sourceKey, title, body, contentHash: bodyHash, scope, status, metadata, keywords: metadata?.keywords || '', mtime: metadata?.mtime || 0, size: metadata?.size || Buffer.byteLength(body || ''), confidence: metadata?.confidence ?? 1, lastVerifiedAt: metadata?.lastVerifiedAt || null, updatedAt}),
        disable: ({projectKey, sourceKey, updatedAt} = {}) => store.upsertMemoryIndex({...syncMemoryRepository(store).get({projectKey, sourceKey}), projectKey, sourcePath: sourceKey, status: 'disabled', updatedAt}),
        remove: ({projectKey, sourceKey} = {}) => store.removeMemoryIndex(projectKey, sourceKey),
        markUsed: ({projectKey, sourceKey, usedAt} = {}) => store.markMemoryUsed(projectKey, sourceKey, usedAt),
    }
}

function fixture() {
    const bridgeHome = mkdtempSync(join(tmpdir(), 'bridge-memory-admin-'))
    const encodedDir = 'D--demo'
    const workDir = 'D:\\demo'
    mkdirSync(join(bridgeHome, 'projects', encodedDir), {recursive: true})
    const {store: stateStore} = createPostgresStateFixture()
    const memoryService = createMemoryService({bridgeHome, memoryRepository: syncMemoryRepository(stateStore)})
    return {bridgeHome, encodedDir, workDir, stateStore, memoryService}
}

test('Memory 管理支持保存、搜索、停用、重建和删除', t => {
    const ctx = fixture()
    t.after(() => ctx.stateStore.close())
    assert.deepEqual(saveProjectMemory({...ctx, filename: 'encoding.md', content: '# 编码\n使用 UTF-8'}), {
        filename: 'encoding.md', size: Buffer.byteLength('# 编码\n使用 UTF-8'),
    })
    const listed = listProjectMemory({...ctx, query: 'UTF-8'})
    assert.equal(listed.files.length, 1)
    assert.equal(listed.files[0].status, 'active')
    assert.equal(listed.files[0].scope, 'project')
    assert.equal(setProjectMemoryEnabled({...ctx, filename: 'encoding.md', enabled: false}).status, 'disabled')
    assert.equal(listProjectMemory(ctx).files[0].status, 'disabled')
    assert.equal(rebuildProjectMemory(ctx).indexed, 1)
    assert.equal(listProjectMemory(ctx).files[0].status, 'disabled')
    assert.equal(deleteProjectMemory({...ctx, filename: 'encoding.md'}).filename, 'encoding.md')
    assert.deepEqual(listProjectMemory(ctx).files, [])
})

test('Memory 管理拒绝越界文件名、非字符串和超限内容', t => {
    const ctx = fixture()
    t.after(() => ctx.stateStore.close())
    assert.throws(() => saveProjectMemory({...ctx, filename: '../bad.md', content: 'x'}), {code: 'MEMORY_PATH_INVALID'})
    assert.throws(() => saveProjectMemory({...ctx, filename: 'bad.md', content: null}), {code: 'MEMORY_CONTENT_INVALID'})
    assert.throws(() => saveProjectMemory({...ctx, filename: 'large.md', content: 'x'.repeat(512 * 1024 + 1)}), {code: 'MEMORY_FILE_TOO_LARGE'})
})

test('PostgreSQL-only Memory 没有 md 副本时仍可在设置页读取', async t => {
    const ctx = fixture()
    t.after(() => ctx.stateStore.close())
    ctx.memoryService.memoryRepository.put({
        projectKey: ctx.encodedDir,
        sourceKey: 'memory/database-only.md',
        title: '数据库主存储',
        body: '正文只存在 PostgreSQL',
        bodyHash: 'hash-database-only',
        scope: 'project',
        status: 'active',
        metadata: {keywords: '数据库', lifecycle: 'active', approvedBy: 'test'},
    })
    const listed = await listProjectMemoryAsync(ctx)
    assert.equal(listed.mode, 'postgres')
    assert.equal(listed.files.length, 1)
    assert.equal(listed.files[0].filename, 'database-only.md')
    assert.equal(listed.files[0].content, '正文只存在 PostgreSQL')
})

test('设置页列表只读取 PostgreSQL，不扫描本地 md 副本', async t => {
    const ctx = fixture()
    t.after(() => ctx.stateStore.close())
    mkdirSync(join(ctx.bridgeHome, 'projects', ctx.encodedDir, 'memory'), {recursive: true})
    writeFileSync(join(ctx.bridgeHome, 'projects', ctx.encodedDir, 'memory', 'legacy.md'), '本地兼容副本')
    ctx.memoryService.memoryRepository.put({
        projectKey: ctx.encodedDir,
        sourceKey: 'memory/database.md',
        title: '数据库记录',
        body: '主存储正文',
        bodyHash: 'hash-database',
        scope: 'project',
        status: 'active',
        metadata: {keywords: '数据库', lifecycle: 'active', approvedBy: 'test'},
    })
    const listed = await listProjectMemoryAsync(ctx)
    assert.deepEqual(listed.files.map(file => file.filename), ['database.md'])
})

test('设置页异步保存和删除只操作 PostgreSQL，不创建本地 md', async t => {
    const ctx = fixture()
    t.after(() => ctx.stateStore.close())
    const {saveProjectMemoryAsync, deleteProjectMemoryAsync} = await import('./memory-admin.mjs')
    await saveProjectMemoryAsync({...ctx, filename: 'database-only.md', content: '只保存到 PostgreSQL'})
    assert.equal(existsSync(join(ctx.bridgeHome, 'projects', ctx.encodedDir, 'memory', 'database-only.md')), false)
    assert.equal((await listProjectMemoryAsync(ctx)).files[0].content, '只保存到 PostgreSQL')
    await deleteProjectMemoryAsync({...ctx, filename: 'database-only.md'})
    assert.deepEqual((await listProjectMemoryAsync(ctx)).files, [])
})
