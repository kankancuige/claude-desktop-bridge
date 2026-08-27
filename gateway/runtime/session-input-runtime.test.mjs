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

test('SDK watchdog 在等待授权时不会把活跃任务误判为超时', () => {
    const timers = []
    const session = {
        query: null,
        _generating: true,
        activeTurnId: 'turn-1',
        pending: new Map([['req-1', {type: 'permission'}]]),
        _pendingInputs: [],
        taskState: {turnId: 'turn-1'},
        queryOpts: {abortController: new AbortController()},
        pushStream: {close() {}},
    }
    const query = {close() {}}
    session.query = query
    const sessions = new Map([['s1', session]])
    let failed = 0
    const runtime = createSessionInputRuntime({
        taskInputQueue: {drain: () => []},
        createTurnIdentity: () => null,
        selectCancelledTurnInputs: values => values,
        broadcastTurn() {},
        sessions,
        sessionCoordinator: {clearTimeout() {}, beginTimeout() {}, isTimeoutCurrent: () => true},
        streamIdleTimeoutMs: 100,
        updateTaskCompletion() { failed++; return {effects: []} },
        applyTaskCompletionEffects: async () => {},
        taskStateForError: () => ({}),
        updateTaskState() {},
        appendSessionEvent() {},
        taskStateForClient: value => value,
        broadcastTaskLifecycle() {},
        setTimer(callback) {
            const timer = {callback, unref() {}}
            timers.push(timer)
            return timer
        },
        clearTimer() {},
    })

    runtime.armStreamWatchdog('s1', session, query)
    timers[0].callback()
    assert.equal(failed, 0)
    assert.equal(timers.length, 2)

    session.pending.clear()
    timers[1].callback()
    assert.equal(failed, 1)
})

test('SDK watchdog 对活动工具使用更长窗口，并在绝对时限到达时立即收口', () => {
    const timers = []
    let now = 1_000
    const session = {
        query: null, _generating: true, activeTurnId: 'turn-1', pending: new Map(), _pendingInputs: [],
        _activeTools: new Map([['tool-1', {toolName: 'Bash', startedAt: now, lastProgressAt: now}]]),
        taskStartedAt: now, taskState: {turnId: 'turn-1'}, queryOpts: {abortController: new AbortController()},
        pushStream: {close() {}},
    }
    const query = {close() {}}
    session.query = query
    const sessions = new Map([['s1', session]])
    let failed = 0
    const runtime = createSessionInputRuntime({
        taskInputQueue: {drain: () => []}, createTurnIdentity: () => null,
        selectCancelledTurnInputs: values => values, broadcastTurn() {}, sessions,
        sessionCoordinator: {clearTimeout() {}, beginTimeout() {}, isTimeoutCurrent: () => true},
        streamIdleTimeoutMs: 100, streamToolIdleTimeoutMs: 500, streamMaxDurationMs: 700,
        updateTaskCompletion() { failed++; return {effects: []} }, applyTaskCompletionEffects: async () => {},
        taskStateForError: () => ({}), updateTaskState() {}, appendSessionEvent() {},
        taskStateForClient: value => value, broadcastTaskLifecycle() {},
        setTimer(callback, delay) { const timer = {callback, delay, unref() {}}; timers.push(timer); return timer },
        clearTimer() {},
        now: () => now,
    })

    runtime.armStreamWatchdog('s1', session, query)
    assert.equal(timers[0].delay, 500)
    now = 1_700
    timers[0].callback()
    assert.equal(failed, 1)
})

test('SDK 流在等待 Provider 时发送心跳，但不重置 watchdog', () => {
    const timers = []
    const events = []
    let now = 1_000
    const session = {
        query: null, _generating: true, activeTurnId: 'turn-1', pending: new Map(), _pendingInputs: [],
        taskStartedAt: now, taskState: {turnId: 'turn-1'}, queryOpts: {abortController: new AbortController()},
        pushStream: {close() {}}, activeTurnIdentity: {source: 'desktop'},
    }
    const query = {close() {}}
    session.query = query
    const sessions = new Map([['s1', session]])
    const runtime = createSessionInputRuntime({
        taskInputQueue: {drain: () => []}, createTurnIdentity: () => null,
        selectCancelledTurnInputs: values => values, broadcastTurn: (_id, event) => events.push(event), sessions,
        sessionCoordinator: {clearTimeout() {}, beginTimeout() {}, isTimeoutCurrent: () => true},
        streamIdleTimeoutMs: 100, streamHeartbeatIntervalMs: 50,
        updateTaskCompletion() { return {effects: []} }, applyTaskCompletionEffects: async () => {},
        taskStateForError: () => ({}), updateTaskState() {}, appendSessionEvent() {},
        taskStateForClient: value => value, broadcastTaskLifecycle() {},
        setTimer(callback, delay) { const timer = {callback, delay, unref() {}}; timers.push(timer); return timer },
        clearTimer() {}, now: () => now,
    })

    runtime.armStreamWatchdog('s1', session, query)
    assert.equal(timers[0].delay, 100)
    assert.equal(timers[1].delay, 50)
    now = 1_050
    timers[1].callback()
    assert.equal(events[0].type, 'stream_waiting')
    assert.equal(events[0].waitingFor, 'provider')
    assert.equal(timers[0].delay, 100)
})

test('空闲长连接不会注册 Provider 等待心跳或 watchdog', () => {
    const timers = []
    const events = []
    const session = {
        query: null, _generating: false, activeTurnId: null, pending: new Map(), _pendingInputs: [],
        taskState: {status: 'idle'}, queryOpts: {abortController: new AbortController()},
    }
    const query = {close() {}}
    session.query = query
    const sessions = new Map([['s1', session]])
    const runtime = createSessionInputRuntime({
        taskInputQueue: {drain: () => []}, createTurnIdentity: () => null,
        selectCancelledTurnInputs: values => values, broadcastTurn: (_id, event) => events.push(event), sessions,
        sessionCoordinator: {clearTimeout() {}, beginTimeout() {}, isTimeoutCurrent: () => true},
        streamIdleTimeoutMs: 100, streamHeartbeatIntervalMs: 50,
        updateTaskCompletion() {}, applyTaskCompletionEffects: async () => {}, taskStateForError: () => ({}),
        updateTaskState() {}, appendSessionEvent() {}, taskStateForClient: value => value, broadcastTaskLifecycle() {},
        setTimer(callback, delay) { const timer = {callback, delay, unref() {}}; timers.push(timer); return timer },
        clearTimer() {},
    })

    runtime.armStreamWatchdog('s1', session, query)
    assert.equal(timers.length, 0)
    assert.equal(events.length, 0)
})
