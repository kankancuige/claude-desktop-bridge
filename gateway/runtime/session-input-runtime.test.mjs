import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionInputRuntime} from './session-input-runtime.mjs'

test('Session 输入 Runtime 通过队列端口接收、回滚和取消输入', () => {
    const events = []
    const queue = {
        accept: (_session, value) => value,
        rollback: (_session, value) => value,
        drain: () => [{source: 'wechat', userId: 'u1', turnId: 't1'}],
    }
    const runtime = createSessionInputRuntime({
        taskInputQueue: queue, createTurnIdentity: (source, userId) => ({source, userId}),
        selectCancelledTurnInputs: values => values, broadcastTurn: (...args) => events.push(args),
        sessions: new Map(), sessionCoordinator: {clearTimeout() {}, beginTimeout() {}, isTimeoutCurrent: () => false},
        updateTaskCompletion() {}, applyTaskCompletionEffects: async () => {}, taskStateForError: () => ({}),
        updateTaskState() {}, appendSessionEvent() {}, taskStateForClient: value => value, broadcastTaskLifecycle() {},
        imSources: ['wechat'],
    })
    assert.deepEqual(runtime.acceptSessionInput({}, 'wechat', 'm1'), {source: 'wechat', messageId: 'm1', userId: null, taskDecision: null})
    assert.deepEqual(runtime.rollbackSessionInput({}, {accepted: true}), {accepted: true})
    assert.equal(runtime.cancelPendingSessionInputs('s1', {}), 1)
    assert.equal(events[0][1].type, 'generation_stopped')
})

test('Session 输入 Runtime 缺少依赖时立即失败', () => {
    assert.throws(() => createSessionInputRuntime(), /dependencies are required/)
})
