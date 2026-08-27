import assert from 'node:assert/strict'
import test from 'node:test'
import {createUsageRoutes} from './usage-routes.mjs'

function response() { return {headers: {}, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers) }, end(body) { this.body = body }} }

test('usage route 返回脱敏汇总、趋势和活跃会话', async () => {
    const handler = createUsageRoutes({
        getUsageStore: () => ({summarizeModelUsage: () => ({from: 1, to: 2, totals: {eventCount: '1', inputTokens: '4'}, trend: [{day: '2026-08-27', eventCount: '1'}]}), listModelUsageHistory: () => [{eventId: 'e', model: 'm', inputTokens: 4, secret: 'no'}]}),
        getSessions: () => new Map([['s', {query: {}, pushStream: {}, _generating: true}]]),
        getState: () => ({degraded: false}),
    })
    const res = response()
    assert.equal(await handler({req: {method: 'GET'}, res, url: new URL('http://127.0.0.1/api/usage/history')}), true)
    const body = JSON.parse(res.body)
    assert.equal(body.summary.inputTokens, 4)
    assert.equal(body.activeSessions.active, true)
    assert.equal(body.events[0].secret, undefined)
})

test('空闲长连接不计为 AI 调用，排队和重建中的任务仍计入', async () => {
    const handler = createUsageRoutes({
        getUsageStore: () => ({summarizeModelUsage: () => ({totals: {}, trend: []}), listModelUsageHistory: () => []}),
        getSessions: () => new Map([
            ['idle', {query: {}, pushStream: {}, _generating: false}],
            ['queued', {_pendingInputs: [{}]}],
            ['rebuilding', {_rebuildPromise: Promise.resolve()}],
        ]),
    })
    const res = response()
    await handler({req: {method: 'GET'}, res, url: new URL('http://127.0.0.1/api/usage/history')})
    assert.deepEqual(JSON.parse(res.body).activeSessions, {active: true, count: 2})
})

test('usage route 在账本不可用时返回 503', async () => {
    const handler = createUsageRoutes({getUsageStore: () => null})
    const res = response()
    await handler({req: {method: 'GET'}, res, url: new URL('http://127.0.0.1/api/usage/history')})
    assert.equal(res.status, 503)
})
