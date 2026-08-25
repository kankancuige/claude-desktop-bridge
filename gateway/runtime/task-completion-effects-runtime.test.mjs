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
