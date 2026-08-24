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
