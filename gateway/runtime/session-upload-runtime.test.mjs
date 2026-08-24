import assert from 'node:assert/strict'
import test from 'node:test'
import {createSessionUploadRuntime} from './session-upload-runtime.mjs'

function createRuntime(overrides = {}) {
    const calls = []
    const runtime = createSessionUploadRuntime({
        safeChildPath(root, child) {
            if (!root || child.includes('..') || child.includes('/') || child.includes('\\')) return null
            return `${root}/${child}`
        },
        cleanupUploadDir(path, options) {
            calls.push({path, options})
            return {removed: 1, bytes: 4}
        },
        prepareUploadDir(path, options) {
            calls.push({path, options, prepare: true})
        },
        statSync() {
            return {isDirectory: () => true}
        },
        ttlMs: 60_000,
        ...overrides,
    })
    return {runtime, calls}
}

test('Session ID 校验拒绝路径穿越和非法字符', () => {
    const {runtime} = createRuntime()
    assert.equal(runtime.isValidSessionId('session-1_ok'), true)
    assert.equal(runtime.isValidSessionId('../escape'), false)
    assert.equal(runtime.isValidSessionId(''), false)
    assert.equal(runtime.isValidSessionId('.'), false)
    assert.equal(runtime.isValidSessionId('a/b'), false)
})

test('上传目录只允许固定根和合法 Session ID', () => {
    const {runtime} = createRuntime()
    assert.equal(runtime.getUploadDir('C:/work', 'session-1'), 'C:/work/.bridge-uploads/session-1')
    assert.equal(runtime.getUploadDir('C:/work', '../escape'), null)
    assert.equal(runtime.getUploadDir('', 'session-1'), null)
})

test('清理和准备端口统一传递 TTL、删除策略和日志钩子', () => {
    const {runtime, calls} = createRuntime()
    assert.deepEqual(runtime.cleanupSessionUploads('C:/work', 'session-1', true), {removed: 1, bytes: 4})
    assert.equal(runtime.prepareSessionUploadDir('C:/work', 'session-1'), 'C:/work/.bridge-uploads/session-1')
    assert.equal(calls.length, 2)
    assert.equal(calls[0].options.removeAll, true)
    assert.equal(calls[0].options.ttlMs, 60_000)
    assert.equal(calls[1].prepare, true)
})

test('无效工作目录返回 false，不把 stat 错误抛到 HTTP 层', () => {
    const {runtime} = createRuntime()
    assert.equal(runtime.isDirectoryPath(''), false)
    assert.equal(runtime.isDirectoryPath(null), false)
})
