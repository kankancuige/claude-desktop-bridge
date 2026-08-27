import test from 'node:test'
import assert from 'node:assert/strict'
import {createSdkStreamService} from './sdk-stream-service.mjs'

const wait = promise => new Promise((resolve, reject) => promise.then(resolve, reject))

test('上下文采样超时后释放 in-flight 状态并允许下一次采样', async () => {
    const events = []
    let rejectTimeout
    const service = createSdkStreamService({
        withTimeout: () => new Promise((_, reject) => { rejectTimeout = reject }),
        broadcast: (_id, event) => events.push(event),
        logger: {debug() {}, warn() {}},
    })
    const session = {query: {getContextUsage() { return new Promise(() => {}) }}}
    const first = service.refreshContextUsage('s1', session, 'test')
    rejectTimeout(new Error('timeout'))
    await wait(first)
    assert.equal(session._contextUsageInFlight, null)
    assert.doesNotThrow(() => service.refreshContextUsage('s1', session, 'retry'))
    assert.equal(events.length, 0)
})

test('Provider usage 只通过注入的状态存储和广播出口落账', () => {
    const events = []
    const persisted = []
    const service = createSdkStreamService({
        withTimeout: promise => promise,
        getStateStore: () => ({appendModelUsageEvent: event => { persisted.push(event); return true }}),
        getSessionProjectKey: () => 'project',
        broadcast: (_id, event) => events.push(event),
    })
    const result = service.recordProviderUsage('s1', {workDir: 'D:/project'}, {usage: {input_tokens: 2, output_tokens: 1}})
    assert.equal(result.persisted, true)
    assert.equal(persisted.length, 1)
    assert.equal(events[0].type, 'model_usage_observed')
})

test('Provider usage 在回合开始落 pending，并在结束时更新同一事件', async () => {
    const persisted = []
    const updates = []
    const service = createSdkStreamService({
        withTimeout: promise => promise,
        getStateStore: () => ({
            appendModelUsageEvent: event => { persisted.push(event); return Promise.resolve(true) },
            updateModelUsageEvent: (id, event) => { updates.push([id, event]); return Promise.resolve(true) },
        }),
        getSessionProjectKey: () => 'project',
        broadcast() {},
        now: () => 100,
    })
    const session = {workDir: 'D:/project'}
    const id = await service.beginProviderUsage('s1', session, {type: 'user'})
    assert.equal(persisted.length, 1)
    assert.equal(persisted[0].status, 'pending')
    const result = await service.finishProviderUsage('s1', session, {usage: {input_tokens: 2, output_tokens: 1}})
    assert.equal(result.event.eventId, id)
    assert.equal(result.event.status, 'completed')
    assert.equal(updates.length, 1)
    assert.equal(updates[0][0], id)
})
