import test from 'node:test'
import assert from 'node:assert/strict'
import {createShutdownRuntime} from './shutdown-runtime.mjs'

test('关闭按资源顺序执行，重复请求只执行一次', async () => {
    const calls = []
    let exited = null
    const controller = new AbortController()
    const runtime = createShutdownRuntime({
        adapters: ['wechat'],
        stopAdapter: platform => calls.push(`adapter:${platform}`),
        wsPingTimer: setInterval(() => {}, 60_000),
        wss: {clients: new Set([{close: () => calls.push('ws')}])},
        sessions: new Map([['s1', {
            pushStream: {close: () => calls.push('stream')},
            queryOpts: {abortController: controller},
            query: {close: () => calls.push('query-close'), return: () => Promise.resolve()},
            eventJournal: {close: () => calls.push('journal')},
        }]]),
        appendSessionEvent: () => calls.push('event'),
        providerRegistry: {disposeAll: async () => calls.push('provider')},
        httpServer: {listening: false},
        exit: code => {exited = code},
        timeoutMs: 20,
    })
    assert.equal(await runtime.shutdown('test'), true)
    assert.equal(await runtime.shutdown('repeat'), false)
    assert.equal(exited, 0)
    assert.deepEqual(calls.slice(0, 3), ['adapter:wechat', 'ws', 'stream'])
    assert.ok(calls.includes('query-close'))
    assert.equal(controller.signal.reason, 'shutdown')
    assert.equal(calls.filter(item => item === 'provider').length, 1)
})

test('单个资源关闭失败不会阻断数据库和 HTTP 清理', async () => {
    const calls = []
    const runtime = createShutdownRuntime({
        stopAdapter: () => { throw new Error('adapter failed') },
        adapters: ['wechat'],
        getStateDb: () => ({close: async () => calls.push('db')}),
        getStorageGateway: () => ({close: async () => calls.push('storage')}),
        httpServer: {listening: false},
        exit: () => calls.push('exit'),
    })
    await runtime.shutdown('failure')
    assert.deepEqual(calls, ['db', 'storage', 'exit'])
})

test('关停前请求每个 Session 写入停止终态', async () => {
    const calls = []
    const runtime = createShutdownRuntime({
        sessions: new Map([['s1', {pending: new Map(), pushStream: {close() {}}, query: {return() {}}}]]),
        stopSessionGeneration: async (sid) => { calls.push(`stop:${sid}`) },
        appendSessionEvent: () => calls.push('event'),
        httpServer: {listening: false},
        exit: () => calls.push('exit'),
    })
    await runtime.shutdown('terminal-state')
    assert.ok(calls.indexOf('stop:s1') >= 0)
    assert.ok(calls.indexOf('event') >= 0)
    assert.equal(calls.at(-1), 'exit')
})
