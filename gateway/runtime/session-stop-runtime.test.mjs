import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionStopRuntime} from './session-stop-runtime.mjs'
import {createSessionResourceRuntime} from './session-resource-runtime.mjs'

test('Session Stop Runtime 对无可停止工作返回稳定结果', async () => {
    const runtime = createSessionStopRuntime({
        sessions: new Map(), getSessionWorkflowStates: () => [], hasStoppableSessionWork: () => false,
        clearStreamWatchdog() {}, getSessionStopScope: () => ({activeWorkflows: [], primaryActive: false}),
        stopWorkflow() {}, broadcastTaskLifecycle() {}, resolvePrimaryStopTurnId: () => null,
        updateTaskCompletion() {}, getTaskWorkbench: () => null, clearTaskWorkflowGate() {},
        sessionCoordinator: {cancel() {}}, settlePending() {}, closeSessionRuntime: async () => {},
        finalizeCheckpoint() {}, cancelPendingSessionInputs: () => 0, taskStateForStop: () => ({}),
        updateTaskState() {}, appendSessionEvent() {}, broadcastTurn() {}, taskStateForClient: value => value,
    })
    assert.deepEqual(await runtime.stopSessionGeneration('s1', {}), {stopped: false, cancelledInputs: 0})
})

test('Session Stop Runtime 缺少依赖时立即失败', () => {
    assert.throws(() => createSessionStopRuntime(), /dependencies are required/)
})

test('Workflow-only 停止清理 Gate、pending 输入和运行时资源', async () => {
    const calls = []
    const gate = {active: new Set(['wf-1'])}
    const session = {
        _taskWorkflowGate: gate,
        pending: new Map([['permission-1', {}]]),
        _pendingInputs: [{turnId: 'queued-turn'}],
        _pendingTurns: [{turnId: 'queued-turn'}],
        query: {return() { calls.push('query-return') }},
        pushStream: {close() { calls.push('stream-close') }},
        _generating: false,
        taskCompletion: {phase: 'succeeded'},
    }
    let clearGate = 0
    let cancelled = 0
    const runtime = createSessionStopRuntime({
        sessions: new Map([['s1', session]]),
        getSessionWorkflowStates: () => [{wfId: 'wf-1', status: 'running'}],
        hasStoppableSessionWork: () => true,
        clearStreamWatchdog() { calls.push('watchdog-clear') },
        getSessionStopScope: () => ({activeWorkflows: [{wfId: 'wf-1'}], primaryActive: false}),
        stopWorkflow(id) { calls.push(`stop-workflow:${id}`) },
        broadcastTaskLifecycle() { calls.push('broadcast') },
        resolvePrimaryStopTurnId: () => null,
        updateTaskCompletion() { calls.push('completion-update') },
        getTaskWorkbench: () => null,
        clearTaskWorkflowGate(value) { clearGate += 1; value.active.clear() },
        sessionCoordinator: {cancel(_session, reason) { calls.push(`cancel:${reason}`) }},
        settlePending(_sid, id) { calls.push(`settle:${id}`) },
        closeSessionRuntime: async value => { calls.push('runtime-close'); value.query = null; value.pushStream = null },
        finalizeCheckpoint() {},
        cancelPendingSessionInputs() { cancelled += 1; return 1 },
        taskStateForStop: () => ({}), updateTaskState() {}, appendSessionEvent() {},
        broadcastTurn() {}, taskStateForClient: value => value,
    })
    const result = await runtime.stopSessionGeneration('s1', session)
    assert.deepEqual(result, {stopped: true, scope: 'workflow', cancelledInputs: 1, turnId: null})
    assert.equal(clearGate, 1)
    assert.equal(gate.active.size, 0)
    assert.equal(session._generating, false)
    assert.equal(session.query, null)
    assert.equal(session.pushStream, null)
    assert.ok(calls.includes('stop-workflow:wf-1'))
    assert.ok(calls.includes('runtime-close'))
})

test('主任务停止会关闭 SDK Query 并取消 native Agent 进程的控制信号', async () => {
    const controller = new AbortController()
    let queryClosed = 0
    const resourceRuntime = createSessionResourceRuntime({
        withTimeout: promise => promise,
        sessionCoordinator: {clearTimeout() {}},
    })
    const session = {
        query: {close() { queryClosed += 1 }},
        queryOpts: {abortController: controller},
        pushStream: {close() {}},
        pending: new Map(),
        _generating: true,
        activeTurnId: 'turn-1',
        activeTurnIdentity: {turnId: 'turn-1'},
        taskCompletion: {phase: 'running'},
        taskState: {startedAt: Date.now()},
        _taskWorkflowGate: {active: new Set()},
        _pendingTurns: [],
    }
    const runtime = createSessionStopRuntime({
        sessions: new Map([['s1', session]]),
        getSessionWorkflowStates: () => [],
        hasStoppableSessionWork: () => true,
        clearStreamWatchdog() {},
        getSessionStopScope: () => ({activeWorkflows: [], primaryActive: true}),
        stopWorkflow() {},
        broadcastTaskLifecycle() {},
        resolvePrimaryStopTurnId: () => 'turn-1',
        updateTaskCompletion() {},
        getTaskWorkbench: () => null,
        clearTaskWorkflowGate() {},
        sessionCoordinator: {cancel() {}},
        settlePending() {},
        closeSessionRuntime: resourceRuntime.closeSessionRuntime,
        finalizeCheckpoint() {},
        cancelPendingSessionInputs: () => 0,
        taskStateForStop: () => ({status: 'stopped', durationMs: 1}),
        updateTaskState(value, _sessionId, state) { value.taskState = state },
        appendSessionEvent() {},
        broadcastTurn() {},
        taskStateForClient: value => value,
    })
    const result = await runtime.stopSessionGeneration('s1', session)
    assert.equal(result.scope, 'primary')
    assert.equal(queryClosed, 1)
    assert.equal(controller.signal.reason, 'stop_generation')
})
