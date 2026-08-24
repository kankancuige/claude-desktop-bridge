import test from 'node:test'
import assert from 'node:assert/strict'
import {createPostgresStateCompat} from './postgres-state-compat.mjs'

function fakeGateway() {
    const calls = []
    const state = {
        replaceEntries: async (...args) => { calls.push(['replaceEntries', ...args]); return true },
        recordTaskTransition: async record => { calls.push(['task', record]); return true },
        appendTaskEvent: async record => { calls.push(['taskEvent', record]); return true },
        appendModelUsageEvent: async event => { calls.push(['usage', event]); return true },
    }
    return {
        calls,
        state,
        content: {
            put: async value => { calls.push(['content.put', value]); return value },
            remove: async value => { calls.push(['content.remove', value]); return true },
        },
        query: async (sql, values = []) => {
            calls.push(['query', sql, values])
            if (sql.includes('schema_version')) return {rows: [{version: 1}]}
            return {rows: []}
        },
    }
}

test('PostgresStateCompat 保持同步读取并串行写入 PostgreSQL', async () => {
    const gateway = fakeGateway()
    const store = createPostgresStateCompat({gateway})
    await store.load()
    assert.equal(store.available, true)
    assert.equal(store.upsertSessionIndex({projectKey: 'p', sessionId: 's', transcriptPath: 'D:/s.jsonl', mtime: 10, size: 2}).sessionId, 's')
    assert.equal(store.getSessionCatalog('p', 's').transcriptPath, 'D:/s.jsonl')
    assert.equal(store.recordTaskTransition({projectKey: 'p', taskId: 't', taskKey: 't', revision: 1, status: 'running', state: {status: 'running', taskId: 't'}}), true)
    assert.equal(store.recordTaskTransition({projectKey: 'p', taskId: 't', taskKey: 't', revision: 1, status: 'running', state: {status: 'running', taskId: 't'}}), false)
    assert.equal(store.appendTaskEvent({projectKey: 'p', taskKey: 't', eventRevision: 10, eventType: 'task/created', eventPayload: {title: 'x'}}), true)
    store.replaceEntries('inbox', 'wechat', new Map([['wechat:m1', {state: 'processing', at: 1}]]))
    assert.equal(store.loadEntries('inbox', 'wechat').size, 1)
    await store.flush()
    assert.ok(gateway.calls.some(call => call[0] === 'task'))
    assert.ok(gateway.calls.some(call => call[0] === 'taskEvent'))
    assert.ok(gateway.calls.some(call => call[0] === 'replaceEntries'))
})

test('PostgresStateCompat 写入失败只标记 degraded', async () => {
    const gateway = fakeGateway()
    gateway.state.recordTaskTransition = async () => { throw Object.assign(new Error('offline'), {code: 'ECONNRESET'}) }
    const store = createPostgresStateCompat({gateway})
    await store.load()
    assert.equal(store.recordTaskTransition({projectKey: 'p', taskKey: 't', revision: 1, state: {status: 'running'}}), true)
    await store.flush()
    assert.equal(store.mode, 'postgres')
    assert.equal(store.degraded, true)
    assert.equal(store.degradedReason, 'ECONNRESET')
})
