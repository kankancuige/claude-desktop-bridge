import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createProviderClientLifecycle} from './provider-client-lifecycle.mjs'

function createHttpPair() {
    const req = new EventEmitter()
    const res = new EventEmitter()
    res.writableEnded = false
    return {req, res}
}

test('下游请求中止会取消 Provider 请求', () => {
    const {req, res} = createHttpPair()
    const lifecycle = createProviderClientLifecycle(req, res)

    req.emit('aborted')

    assert.equal(lifecycle.signal.aborted, true)
    assert.match(String(lifecycle.signal.reason?.message), /client disconnected/)
})

test('下游响应未完成即断开会取消 Provider 请求', () => {
    const {req, res} = createHttpPair()
    const lifecycle = createProviderClientLifecycle(req, res)

    res.emit('close')

    assert.equal(lifecycle.signal.aborted, true)
})

test('正常完成和显式 finish 不会误取消 Provider 请求', () => {
    const {req, res} = createHttpPair()
    const lifecycle = createProviderClientLifecycle(req, res)
    res.writableEnded = true
    res.emit('close')
    lifecycle.finish()
    req.emit('aborted')

    assert.equal(lifecycle.signal.aborted, false)
    assert.equal(req.listenerCount('aborted'), 0)
    assert.equal(res.listenerCount('close'), 0)
})
