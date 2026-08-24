import test from 'node:test'
import assert from 'node:assert/strict'
import {createSdkStreamRuntime} from './sdk-stream-runtime.mjs'

function makeRuntime(overrides = {}) {
    const deps = {
        sessions: new Map(),
        sessionCoordinator: {},
        broadcastTurn() {},
        sdkStreamAdapter: {toClientEvent() { return null }},
        withTimeout: promise => promise,
        getStateStore: () => null,
        getSessionProjectKey: () => 'project',
        log: {debug() {}, warn() {}, error() {}, info() {}},
        ...overrides,
    }
    return createSdkStreamRuntime(deps)
}

test('SDK Stream Runtime 通过显式依赖创建并拒绝缺少边界', () => {
    assert.throws(() => createSdkStreamRuntime(), /dependencies are required/)
    const runtime = makeRuntime()
    assert.equal(typeof runtime.startStreamPump, 'function')
    assert.equal(typeof runtime.startAutoContinuation, 'function')
})

test('SDK Stream Runtime 对未知 Session 不启动消费循环', async () => {
    const runtime = makeRuntime()
    assert.equal(await runtime.startStreamPump('missing'), undefined)
    assert.equal(await runtime.startAutoContinuation('missing', null, null), false)
})
