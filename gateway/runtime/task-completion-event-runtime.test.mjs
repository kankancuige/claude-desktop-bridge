import test from 'node:test'
import assert from 'node:assert/strict'
import {createTaskCompletionEventRuntime} from './task-completion-event-runtime.mjs'

test('完成事件运行时写入状态、通知意图并广播生命周期', async () => {
    const updates = []
    const messages = []
    const mirrors = []
    const runtime = createTaskCompletionEventRuntime({
        taskStateForInconclusive: (_state, patch) => ({status: 'inconclusive', ...patch}),
        taskStateFromCompletion: () => ({status: 'completed', outcome: 'succeeded', startedAt: 1, durationMs: 2}),
        taskStateWithNotificationIntents: (_session, state, notificationId) => ({...state, notifications: {desktop: notificationId}}),
        taskStateForSessionClient: session => session.taskState,
        updateTaskState: (session, _id, state) => { session.taskState = state; updates.push(state) },
        broadcastTurn: (_id, message) => messages.push(message),
        broadcastTaskLifecycle: id => messages.push({type: 'lifecycle', id}),
        maybeMirror: async (...args) => { mirrors.push(args); return {failed: 0, pending: 0} },
        now: () => 100,
    })
    const session = {taskCompletionTaskId: 'task-1', taskCompletionTurnId: 'turn-1', taskCompletionIdentity: {source: 'desktop'}}
    runtime.taskCompletionEventForClient(session, 's1', 'task_completed', {reply: 'done'})
    await runtime.publishVerificationInconclusive('s1', session, 'need evidence')
    assert.equal(updates.length, 2)
    assert.equal(messages[0].type, 'task_completed')
    assert.equal(messages[1].type, 'lifecycle')
    assert.equal(mirrors.length, 1)
})

test('完成事件运行时缺少状态出口时立即失败', () => {
    assert.throws(() => createTaskCompletionEventRuntime(), /dependencies are required/)
})
