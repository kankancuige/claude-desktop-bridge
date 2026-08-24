import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {createPostgresStateFixture} from '../test-support/postgres-state-fixture.mjs'
import {createMemoryService} from './memory-service.mjs'
import {
    deleteProjectMemory,
    listProjectMemory,
    rebuildProjectMemory,
    saveProjectMemory,
    setProjectMemoryEnabled,
} from './memory-admin.mjs'

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
