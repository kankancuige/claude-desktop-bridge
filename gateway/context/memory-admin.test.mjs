import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {BridgeStateDb} from '../storage/bridge-state-db.mjs'
import {createMemoryService} from './memory-service.mjs'
import {
    deleteProjectMemory,
    listProjectMemory,
    rebuildProjectMemory,
    saveProjectMemory,
    setProjectMemoryEnabled,
} from './memory-admin.mjs'

function fixture() {
    const bridgeHome = mkdtempSync(join(tmpdir(), 'bridge-memory-admin-'))
    const encodedDir = 'D--demo'
    const workDir = 'D:\\demo'
    mkdirSync(join(bridgeHome, 'projects', encodedDir), {recursive: true})
    const stateStore = new BridgeStateDb({bridgeHome})
    const memoryService = createMemoryService({bridgeHome, stateStore})
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
