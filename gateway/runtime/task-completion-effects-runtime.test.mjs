import test from 'node:test'
import assert from 'node:assert/strict'
import {createTaskCompletionEffectsRuntime} from './task-completion-effects-runtime.mjs'

test('完成副作用运行时接收显式依赖并处理空效果', async () => {
    const runtime = createTaskCompletionEffectsRuntime({
        sessions: new Map(),
        updateTaskCompletion() {},
    })
    assert.deepEqual(await runtime.applyTaskCompletionEffects('missing', []), undefined)
})

test('完成副作用运行时缺少会话和状态转换出口时立即失败', () => {
    assert.throws(() => createTaskCompletionEffectsRuntime(), /dependencies are required/)
})

test('完成副作用异常会收口为 task_failed', async () => {
    const events = []
    const session = {taskCompletionTaskId: 'task-1', taskCompletion: {phase: 'reviewing'}, taskState: {status: 'reviewing'}}
    const runtime = createTaskCompletionEffectsRuntime({
        sessions: new Map([['s1', session]]),
        runCoordinatorValidation: async () => { throw new Error('validator offline') },
        updateTaskCompletion(value, _sid, event) {
            value.taskCompletion = {phase: event.type === 'runtime_failed' ? 'failed' : 'reviewing'}
            return {effects: []}
        },
        updateTaskState(_value, _sid, state) { events.push(['state', state.status]) },
        taskStateFromCompletion: () => ({status: 'failed'}),
        taskCompletionEventForClient(_value, _sid, type) { events.push(['event', type]) },
        broadcastTaskLifecycle() { events.push(['lifecycle']) },
        maybeMirror: async () => {},
        log: {error() {}, warn() {}},
    })
    await runtime.applyTaskCompletionEffects('s1', [{type: 'start_review'}])
    assert.deepEqual(events, [['state', 'failed'], ['event', 'task_failed'], ['lifecycle']])
})

test('成功任务收口自动生成 PostgreSQL-backed Memory candidate，但不改变任务终态', async () => {
    const captured = []
    const session = {
        workDir: 'D:/work', taskCompletionTaskId: 'task-1', taskRequestText: '请记住：本项目统一使用 UTF-8',
        taskCompletion: {phase: 'running'}, taskState: {status: 'running'}, taskFinalReplyText: '完成',
    }
    const runtime = createTaskCompletionEffectsRuntime({
        sessions: new Map([['s1', session]]),
        runCoordinatorValidation: async () => ({status: 'passed', verification: {status: 'passed'}}),
        requestCoordinatorCompletion: () => ({status: 'completed'}),
        hasPersistedNotificationIntents: () => true,
        requiredTaskNotificationPlatforms: () => [],
        taskStateFromCompletion: () => ({status: 'succeeded'}),
        updateTaskState() {},
        taskCompletionEventForClient(_session, _id, _type, extra) { assert.equal(extra.memoryCandidatesCreated, 1) },
        maybeMirror: async () => ({failed: 0, pending: 0}),
        updateTaskCompletion() {},
        captureAutomaticMemory: async () => { captured.push({projectKey: 'encoded:D:/work', verifiedFacts: [{summary: '本项目统一使用 UTF-8'}]}); return [{candidateId: 'c1'}] },
        log: {warn() {}, error() {}},
    })
    await runtime.applyTaskCompletionEffects('s1', [{type: 'complete'}])
    assert.equal(captured.length, 1)
    assert.equal(captured[0].projectKey, 'encoded:D:/work')
    assert.equal(captured[0].verifiedFacts[0].summary, '本项目统一使用 UTF-8')
})

test('失败或验证不足任务不自动沉淀 Memory', async () => {
    let calls = 0
    const session = {workDir: 'D:/work', taskCompletionTaskId: 'task-1', taskRequestText: '请记住：临时约定', taskCompletion: {phase: 'running'}}
    const runtime = createTaskCompletionEffectsRuntime({
        sessions: new Map([['s1', session]]),
        updateTaskCompletion() {},
        captureAutomaticMemory: async () => { calls++ },
    })
    await runtime.applyTaskCompletionEffects('s1', [{type: 'pause'}])
    assert.equal(calls, 0)
})
