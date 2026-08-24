import test from 'node:test'
import assert from 'node:assert/strict'
import {createImRuntime} from './im-runtime.mjs'

function makeDeps(overrides = {}) {
    return {
        sessions: new Map(),
        IM_SOURCES: new Set(['wechat', 'feishu', 'dingtalk']),
        ADAPTER_TOKENS: new Map(),
        ADAPTER_STARTERS: new Map(),
        taskCommands: {},
        getNotificationRepository() { return null },
        updateTaskNotificationState() {},
        loadTaskState() { return null },
        buildIncompleteMirrorText() { return '' },
        shouldRouteMirror() { return true },
        stateRepositories() { return {} },
        clearAdapterBindings() { return 0 },
        BRIDGE_HOME: 'C:\bridge',
        join: (...parts) => parts.join('\\'),
        existsSync() { return false },
        unlinkSync() {},
        log: {warn() {}, error() {}},
        createImProgressPolicy: () => ({evaluate() { return {send: false} }}),
        createImProgressReporter() {},
        taskStateForClient(state) { return state },
        ...overrides,
    }
}

test('IM Runtime 暴露适配器生命周期和镜像边界', () => {
    const runtime = createImRuntime(makeDeps())
    assert.equal(typeof runtime.startAdapter, 'function')
    assert.equal(typeof runtime.stopAdapter, 'function')
    assert.equal(typeof runtime.maybeMirror, 'function')
    assert.equal(runtime.confirmHooks.length, 0)
})

test('IM Runtime 缺少 Session/平台边界时立即失败', () => {
    assert.throws(() => createImRuntime({}), /IM runtime dependencies are required/)
})
