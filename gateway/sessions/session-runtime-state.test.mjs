import test from 'node:test'
import assert from 'node:assert/strict'
import {getSessionRuntimeState} from './session-runtime-state.mjs'

test('空闲的长连接 runtime 不应被标记为正在生成', () => {
    assert.deepEqual(getSessionRuntimeState({query: {}, pushStream: {}, _generating: false, _pendingInputs: []}), {
        permissionMode: 'default',
        runtimeReady: true,
        running: true,
        generating: false,
        pendingInputs: 0,
        pendingConfirmations: [],
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

test('runtimeReady 表示长连接已建立，不等同于任务正在执行', () => {
    const state = getSessionRuntimeState({query: {}, pushStream: {}, _generating: false})
    assert.equal(state.runtimeReady, true)
    assert.equal(state.generating, false)
})

test('runtime snapshot exposes sanitized pending confirmation summaries', () => {
    const state = getSessionRuntimeState({pending: new Map([['r1', {
        id: 'r1', type: 'choice', toolName: 'AskUserQuestion', turnId: 't1', source: 'desktop', userId: 'u1',
        expiresAt: 123, questions: [{question: '选择方案', options: [{label: 'A'}, {label: 'B'}]}],
    }]])})
    assert.deepEqual(state.pendingConfirmations[0], {
        requestId: 'r1', type: 'choice', toolName: 'AskUserQuestion', turnId: 't1', source: 'desktop', userId: 'u1',
        expiresAt: 123, question: '选择方案', options: [{label: 'A'}, {label: 'B'}],
    })
})

test('runtime snapshot exposes the session permission mode', () => {
    assert.equal(getSessionRuntimeState({permissionMode: 'acceptEdits'}).permissionMode, 'acceptEdits')
    assert.equal(getSessionRuntimeState({permissionMode: 'invalid'}).permissionMode, 'default')
})
