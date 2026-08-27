import test from 'node:test'
import assert from 'node:assert/strict'
import {consumePendingSessionInputOnResult, getSessionRuntimeState} from './session-runtime-state.mjs'
import {createTaskLifecycleSnapshot} from '../tasks/task-lifecycle.mjs'

test('空闲的长连接 runtime 不应被标记为正在生成', () => {
    assert.deepEqual(getSessionRuntimeState({query: {}, pushStream: {}, _generating: false, _pendingInputs: []}), {
        permissionMode: 'default',
        runtimeReady: true,
        running: true,
        generating: false,
        pendingInputs: 0,
        pendingConfirmations: [],
        diagnostics: {count: 0, byPhase: {}, byError: {}},
    })
})

test('生成中、排队中和重建中都应标记为正在执行', () => {
    assert.equal(getSessionRuntimeState({_generating: true}).generating, true)
    assert.equal(getSessionRuntimeState({_pendingInputs: [{}]}).generating, true)
    assert.equal(getSessionRuntimeState({_pendingMessages: ['task']}).generating, true)
    assert.equal(getSessionRuntimeState({_rebuildPromise: Promise.resolve()}).generating, true)
})

test('SDK 未回传 user 事件时，result 只确认一条已投递输入', () => {
    const session = {
        _pendingInputs: [{turnId: 'turn-1'}, {turnId: 'turn-2'}],
        activeTurnId: null,
    }
    assert.deepEqual(consumePendingSessionInputOnResult(session), {turnId: 'turn-1'})
    assert.deepEqual(session._pendingInputs, [{turnId: 'turn-2'}])
})

test('最后一条未回显输入由 result 确认后，运行时不再保持执行中', () => {
    const session = {
        query: {},
        pushStream: {},
        _generating: false,
        activeTurnId: null,
        _pendingInputs: [{turnId: 'turn-1'}],
    }
    assert.deepEqual(consumePendingSessionInputOnResult(session), {turnId: 'turn-1'})
    assert.equal(getSessionRuntimeState(session).generating, false)
    assert.equal(getSessionRuntimeState(session).pendingInputs, 0)
    const lifecycle = createTaskLifecycleSnapshot({
        sessionId: 'session-1',
        runtime: getSessionRuntimeState(session),
        task: {status: 'succeeded'},
    })
    assert.equal(lifecycle.active, false)
    assert.deepEqual(lifecycle.capabilities, {canSend: true, canStop: false, canContinue: false})
})

test('SDK 已回传 user 事件时，result 不能误确认下一条补充指令', () => {
    const session = {
        _pendingInputs: [{turnId: 'turn-2'}],
        activeTurnId: 'turn-1',
    }
    assert.equal(consumePendingSessionInputOnResult(session), null)
    assert.deepEqual(session._pendingInputs, [{turnId: 'turn-2'}])
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
        questions: [{question: '选择方案', options: [{label: 'A'}, {label: 'B'}]}],
        answers: {},
    })
})

test('runtime snapshot exposes the session permission mode', () => {
    assert.equal(getSessionRuntimeState({permissionMode: 'acceptEdits'}).permissionMode, 'acceptEdits')
    assert.equal(getSessionRuntimeState({permissionMode: 'invalid'}).permissionMode, 'default')
})

test('runtime snapshot carries the latest context usage for reconnecting desktop clients', () => {
    const contextUsage = {type: 'context_usage', totalTokens: 1200, maxTokens: 200000, percentage: 1}
    assert.deepEqual(getSessionRuntimeState({contextUsage}).contextUsage, contextUsage)
})
