import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionStopRuntime} from './session-stop-runtime.mjs'

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
