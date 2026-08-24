import assert from 'node:assert/strict'
import test from 'node:test'
import {buildTaskEventPayload} from './task-event-payload.mjs'

test('任务事件包含稳定身份、序列和时间并限制文本长度', () => {
    const event = buildTaskEventPayload('task/created', {
        id: 'gateway-1', taskCompletionTaskId: 'gateway-1:turn-1', taskCompletionTurnId: 'turn-1',
        taskCompletionIdentity: {source: 'wechat'}, _taskCompletionSequence: 2, _taskStateRevision: 3,
    }, {title: 'x'.repeat(5000), at: 10})
    assert.equal(event.type, 'task/created')
    assert.deepEqual(event.payload, {
        taskId: 'gateway-1:turn-1', sessionId: 'gateway-1', turnId: 'turn-1', source: 'wechat',
        sequence: 2, revision: 3, at: 10, title: 'x'.repeat(4000),
    })
})

test('事件构造只接受可序列化的有限字段', () => {
    const event = buildTaskEventPayload('task/input-appended', {}, {count: 2, ok: true, values: [1, 2, 3]})
    assert.equal(event.payload.count, 2)
    assert.equal(event.payload.ok, true)
    assert.deepEqual(event.payload.values, [1, 2, 3])
})
