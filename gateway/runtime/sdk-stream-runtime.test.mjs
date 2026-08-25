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
        consumePendingSessionInputOnResult: () => null,
        log: {debug() {}, warn() {}, error() {}, info() {}},
        ...overrides,
    }
    return createSdkStreamRuntime(deps)
}

test('SDK Stream Runtime 通过显式依赖创建并拒绝缺少边界', () => {
    assert.throws(() => createSdkStreamRuntime(), /dependencies are required/)
    assert.throws(() => makeRuntime({consumePendingSessionInputOnResult: undefined}), /dependencies are required/)
    const runtime = makeRuntime()
    assert.equal(typeof runtime.startStreamPump, 'function')
    assert.equal(typeof runtime.startAutoContinuation, 'function')
})

test('SDK Stream Runtime 对未知 Session 不启动消费循环', async () => {
    const runtime = makeRuntime()
    assert.equal(await runtime.startStreamPump('missing'), undefined)
    assert.equal(await runtime.startAutoContinuation('missing', null, null), false)
})

test('SDK result 使用启动后才创建的实时 Workbench 收口主 Agent', async () => {
    const calls = []
    const errors = []
    const session = {
        query: {
            async *[Symbol.asyncIterator]() {
                yield {type: 'result', subtype: 'success', result: 'ok', session_id: 'sdk-1'}
            },
        },
        pushStream: {},
        taskCompletion: {phase: 'running'},
        coordinatorTaskId: 'task-1',
        taskState: {status: 'running', startedAt: 1, taskId: 'task-1'},
        taskCompletionDecision: {},
        taskCompletionTaskId: 'task-1',
        taskCompletionTurnId: 'turn-1',
        workDir: 'D:/work',
        lastSessionId: 'sdk-1',
        _pendingInputs: [],
        _pendingSources: [],
        _taskWorkflowGate: {},
        _generating: true,
    }
    const workbench = {
        recordPrimaryResult(_taskId, result) { calls.push(result) },
    }
    const runtime = makeRuntime({
        sessions: new Map([['s1', session]]),
        getTaskWorkbench: () => workbench,
        log: {debug() {}, warn() {}, info() {}, error(error) { errors.push(error) }},
        armStreamWatchdog() {}, clearStreamWatchdog() {},
        consumePendingSessionInputOnResult: () => null,
        taskWorkflowResultIdFromMessage: () => null,
        consumeTaskWorkflowResultTurn: () => null,
        taskInputQueue: {consume: () => ({turnId: 'turn-1', source: 'desktop'})},
        createTurnIdentity: () => ({source: 'desktop'}),
        IM_SOURCES: new Set(['desktop']),
        loadWfConfig: () => ({enabled: false}),
        classifyTaskResult: () => ({outcome: 'succeeded', continuationReason: null}),
        resolveAutoContinuation: () => ({shouldContinue: false}),
        finalizeCheckpoint: () => null,
        resolveFinalReviewPlan: () => ({required: false, tier: 'none', mode: 'none', riskDomains: []}),
        canResumeTask: () => false,
        deferPrimaryResultForTaskWorkflow: () => false,
        takeDeferredPrimaryResult() {},
        taskCompletionEventForClient() {},
        taskStateForClient: value => value,
        taskStateForError: () => ({status: 'failed'}),
        updateTaskCompletion: () => ({effects: []}),
        updateTaskState() {},
        applyTaskCompletionEffects: async () => {},
        sdkStreamAdapter: {toClientEvent: () => null},
        taskCoordinator: {getTaskSnapshot: () => ({phase: 'report'})},
        maybeUpdateProjectCache() {},
        maybeInjectProjectCache() {}, maybeInjectGitContext() {},
        broadcastTaskLifecycle() {}, broadcastDesktop() {}, broadcastTurn() {},
        persistSessionMirrors: () => true, persistSdkSessionId: () => true,
        sessionVisibilitySource: () => null, getProjectVisibility: () => ({}),
        markVisibleSession: () => true, dynamicCache: {}, builtinCache: {}, persistDynamicCache() {},
        appendSessionEvent() {}, failPendingSessionInputs() {},
        clearTaskWorkflowGate() {}, markSessionDeleted() {}, finishImProgressReporters() {},
        clearAdapterBindingsForSessions() {}, invalidateProjectsCache() {}, deleteSessionFiles() {},
        withTimeout: promise => promise,
    })
    await runtime.startStreamPump('s1')
    assert.deepEqual(errors, [])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].status, 'completed')
})
