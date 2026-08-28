import test from 'node:test'
import assert from 'node:assert/strict'
import {createTaskLifecycleRuntime} from './task-lifecycle-runtime.mjs'

function makeRuntime(overrides = {}) {
    return createTaskLifecycleRuntime({
        sessions: new Map(), createTaskStatePatch: value => value, saveTaskState() {}, appendSessionEvent() {},
        journalTaskState: value => value, persistTaskStateProjection: () => true,
        createTaskCompletionState: value => ({phase: value?.phase || 'running', reviewOutcome: {}}),
        taskStateForError: value => value, taskStateForStop: value => value, resolveTaskPhases: () => ({phases: [], requiresProjectContext: false}),
        buildProjectContext: async () => null, resolveTaskAgents: () => [], createTaskPlan: value => value,
        getTaskWorkbench: () => null, getTaskCoordinator: () => null, resolveRequiredNotificationPlatforms: () => [],
        transitionTaskCompletion: () => ({state: {}, effects: []}), getSessionWorkflowStates: () => [], getSessionRuntimeState: () => ({}),
        hasPendingTaskWorkflow: () => false, taskStateForSessionClient: () => ({}), createTaskLifecycleSnapshot: value => value,
        getBroadcastDesktop: () => () => {}, ...overrides,
    })
}

test('任务生命周期 Runtime 更新状态并生成通知意图', () => {
    const runtime = makeRuntime()
    const session = {queryOpts: {}, taskCompletion: {phase: 'running'}, mirrors: {}}
    assert.equal(runtime.updateTaskState(session, 's1', {status: 'running'}).status, 'running')
    assert.deepEqual(runtime.requiredTaskNotificationPlatforms(session), [])
})

test('任务生命周期后续状态更新保留创建时的任务元数据', () => {
    const runtime = makeRuntime()
    const session = {
        queryOpts: {}, taskCompletion: {phase: 'running'}, mirrors: {},
        taskMetadata: {title: '修复任务标题', summary: '任务摘要', goal: '修复任务标题', requestText: '请修复任务标题'},
    }
    const running = runtime.updateTaskState(session, 's1', {status: 'running'})
    const completed = runtime.taskStateFromCompletion({...session, taskCompletion: {phase: 'succeeded'}})
    assert.equal(running.title, '修复任务标题')
    assert.equal(completed.title, '修复任务标题')
    assert.equal(completed.requestText, '请修复任务标题')
})

test('max_turns 暂停原因在完成态投影中保持可恢复', () => {
    const runtime = makeRuntime({
        createTaskCompletionState: value => ({phase: value?.phase || 'running', primaryResult: value?.primaryResult, reviewOutcome: {}}),
    })
    const state = runtime.taskStateFromCompletion({
        lastSessionId: 'sdk-1',
        taskCompletion: {phase: 'incomplete', primaryResult: {continuationReason: 'max_turns'}},
    })
    assert.equal(state.status, 'incomplete')
    assert.equal(state.continuationReason, 'max_turns')
    assert.equal(state.resumable, true)
})

test('任务生命周期 Runtime 缺少依赖时立即失败', () => {
    assert.throws(() => createTaskLifecycleRuntime(), /dependencies are required/)
})

test('简单任务也先建立 ProjectContext 供 Skill 路由复用', async () => {
    const calls = []
    const accepted = []
    const context = {languages: ['C#'], frameworks: ['Avalonia']}
    const runtime = makeRuntime({
        buildProjectContext: async (workDir, options) => { calls.push({workDir, options}); return context },
        getTaskWorkbench: () => ({acceptTask: value => { accepted.push(value); return {pitfalls: []} }}),
    })
    const session = {workDir: 'D:\\avalonia'}
    await runtime.initializeTaskWorkbenchSession({session, sessionId: 's1', taskId: 't1', turnId: 'turn1', source: 'desktop', goal: '调整页面', decision: {executionMode: 'light'}})
    assert.deepEqual(calls, [{workDir: 'D:\\avalonia', options: {persist: true}}])
    assert.equal(session.projectContext, context)
    assert.equal(accepted[0].projectContext, context)
})

test('waiting_user 任务只通过 Coordinator 恢复入口继续', () => {
    const resumed = []
    const coordinator = {
        getTaskSnapshot: taskId => ({taskId, status: 'waiting_user'}),
        resumePlannedTask: input => { resumed.push(input); return {taskId: input.taskId, status: 'running'} },
    }
    const runtime = makeRuntime({getTaskCoordinator: () => coordinator})
    const session = {coordinatorTaskId: 'task-1'}

    assert.equal(runtime.getWaitingCoordinatorTask(session).taskId, 'task-1')
    assert.equal(runtime.resumeWaitingCoordinatorTask(session).status, 'running')
    assert.deepEqual(resumed, [{taskId: 'task-1'}])

    coordinator.getTaskSnapshot = taskId => ({taskId, status: 'completed'})
    assert.equal(runtime.resumeWaitingCoordinatorTask(session), null)
})

test('生命周期快照包含当前 Coordinator 状态', () => {
    const session = {coordinatorTaskId: 'task-1'}
    const runtime = makeRuntime({
        sessions: new Map([['s1', session]]),
        getTaskCoordinator: () => ({getTaskSnapshot: () => ({taskId: 'task-1', status: 'waiting_user'})}),
        createTaskLifecycleSnapshot: value => value,
    })
    assert.deepEqual(runtime.getTaskLifecycleSnapshot('s1').coordinator, {taskId: 'task-1', status: 'waiting_user'})
})
