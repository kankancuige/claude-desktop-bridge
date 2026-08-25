import assert from 'node:assert/strict'
import test from 'node:test'
import {createPostgresStateStore} from './postgres-state-store.mjs'

function fakeGateway() {
    const calls = []
    return {calls, query: async (text, values) => {
        calls.push({text, values})
        if (text.startsWith('INSERT INTO') && text.includes('model_usage_events')) return {rowCount: 1, rows: []}
        if (text.startsWith('SELECT') && text.includes('model_usage_events')) return {rows: [{eventId: 'e1', reasonCodes: ['partial']}]}
        return {rows: [], rowCount: 1}
    }, transaction: async callback => callback({query: async (text, values) => { calls.push({text, values}); return {rowCount: 1, rows: []} }})}
}

test('PostgreSQL state repository 使用参数化 usage SQL 并保留 JSON 字段', async () => {
    const gateway = fakeGateway()
    const store = createPostgresStateStore({gateway})
    assert.equal(await store.appendModelUsageEvent({eventId: 'e1', sessionId: 's1', reasonCodes: ['partial'], inputTokens: 2}), true)
    const row = (await store.listModelUsageEvents('s1'))[0]
    assert.deepEqual(row.reasonCodes, ['partial'])
    const usage = gateway.calls.find(call => call.text.includes('model_usage_events') && call.text.startsWith('INSERT'))
    assert.ok(usage)
    assert.doesNotMatch(usage.text, /e1|s1|partial/)
})

test('state entries replace 在一个事务中清理并批量写入', async () => {
    const gateway = fakeGateway()
    const store = createPostgresStateStore({gateway})
    await store.replaceEntries('inbox', 'wechat', new Map([['wechat:m1', {state: 'processing', at: 1, payload: 'cipher'}]]))
    assert.equal(gateway.calls.filter(call => call.text.startsWith('DELETE FROM')).length, 1)
    assert.equal(gateway.calls.filter(call => call.text.startsWith('INSERT INTO')).length, 1)
})

test('task event append 使用参数化 SQL 并保持重复 revision 幂等', async () => {
    const gateway = fakeGateway()
    const store = createPostgresStateStore({gateway})
    assert.equal(await store.appendTaskEvent({projectKey: 'p', taskKey: 't', eventRevision: 7, eventType: 'task/created', eventPayload: {summary: '摘要'}}), true)
    const event = gateway.calls.find(call => call.text.includes('task_events') && call.text.startsWith('INSERT'))
    assert.ok(event)
    assert.doesNotMatch(event.text, /task\/created|摘要/)
    assert.deepEqual(event.values.slice(0, 5), ['p', 't', 7, 'task/created', JSON.stringify({summary: '摘要'})])
})

test('task state 持久化顶层终态和恢复字段', async () => {
    const gateway = fakeGateway()
    const store = createPostgresStateStore({gateway})
    await store.recordTaskTransition({
        projectKey: 'p', taskKey: 't', taskId: 't', revision: 9,
        status: 'succeeded', outcome: 'succeeded', continuationReason: null,
        phase: 'succeeded', reviewState: 'passed', errorCode: null,
        state: {status: 'succeeded', outcome: 'succeeded', resumable: false},
    })
    const task = gateway.calls.find(call => call.text.includes('task_state') && call.text.startsWith('INSERT'))
    assert.ok(task)
    assert.match(task.text, /status, outcome, continuation_reason, phase, review_state, model_tier, error_code/)
    assert.deepEqual(task.values.slice(0, 13), [
        'p', 't', null, 't', null, 'succeeded', 'succeeded', null,
        'succeeded', 'passed', null, null, 0,
    ])
})
