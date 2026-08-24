import assert from 'node:assert/strict'
import test from 'node:test'
import {createTaskEventRepository} from './task-event-repository.mjs'

test('TaskEventRepository 通过状态端口查询有序事件和过滤条件', () => {
    const calls = []
    const repository = createTaskEventRepository({stateStore: {listTaskEvents: options => { calls.push(options); return [{revision: 2}, {revision: 1}] }}})
    assert.deepEqual(repository.list({projectKey: 'p', taskId: 't', limit: 2, before: 3, after: 0, eventType: 'task/created'}), [{revision: 1}, {revision: 2}])
    assert.deepEqual(calls[0], {projectKey: 'p', taskId: 't', limit: 2, before: 3, after: 0, eventType: 'task/created'})
})
