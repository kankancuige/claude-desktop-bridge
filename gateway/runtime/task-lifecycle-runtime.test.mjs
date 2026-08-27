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

test('任务生命周期 Runtime 缺少依赖时立即失败', () => {
    assert.throws(() => createTaskLifecycleRuntime(), /dependencies are required/)
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
