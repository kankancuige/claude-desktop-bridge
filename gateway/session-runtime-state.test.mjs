import test from 'node:test'
import assert from 'node:assert/strict'
import {getSessionRuntimeState} from './session-runtime-state.mjs'

test('空闲的长连接 runtime 不应被标记为正在生成', () => {
    assert.deepEqual(getSessionRuntimeState({query: {}, pushStream: {}, _generating: false, _pendingInputs: []}), {
        running: true,
        generating: false,
        pendingInputs: 0,
    })
})

test('生成中、排队中和重建中都应标记为正在执行', () => {
    assert.equal(getSessionRuntimeState({_generating: true}).generating, true)
    assert.equal(getSessionRuntimeState({_pendingInputs: [{}]}).generating, true)
    assert.equal(getSessionRuntimeState({_pendingMessages: ['task']}).generating, true)
    assert.equal(getSessionRuntimeState({_rebuildPromise: Promise.resolve()}).generating, true)
})

test('runtime state does not expose persisted task internals', () => {
    const state = getSessionRuntimeState({taskState: {sdkSessionId: 'sdk-secret'}})
    assert.equal('taskState' in state, false)
})
