import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionCleanupRuntime} from './session-cleanup-runtime.mjs'

test('Session Cleanup Runtime 暴露头读取和孤儿清理端口', () => {
    const runtime = createSessionCleanupRuntime({
        bridgeHome: 'D:/bridge', readdirSync: () => [], statSync: () => ({isDirectory: () => true}),
        existsSync: () => false, unlinkSync() {}, rmSync() {}, openSync() { return 1 },
        readSync: (_fd, buffer) => { buffer.write('a\n'); return 2 }, closeSync() {},
    })
    assert.deepEqual(runtime.readFileHeadLines('x', 8), ['a'])
    assert.deepEqual(runtime.cleanupOrphanSessionDirs(), {cleaned: 0})
})

test('Session Cleanup Runtime 缺少依赖时立即失败', () => {
    assert.throws(() => createSessionCleanupRuntime(), /dependencies are required/)
})
