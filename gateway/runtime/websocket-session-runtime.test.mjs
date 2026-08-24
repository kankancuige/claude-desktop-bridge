import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createWebSocketSessionRuntime} from './websocket-session-runtime.mjs'

class FakeWss extends EventEmitter {}

test('WebSocket Session Runtime 注册连接边界并拒绝缺少会话', () => {
    const wss = new FakeWss()
    const controlClients = new Set()
    const runtime = createWebSocketSessionRuntime({
        wss, controlClients, sessions: new Map(), IM_SOURCES: new Set(),
    })
    assert.equal(runtime.controlClients, controlClients)
    const ws = {close(code) { this.closed = code }}
    wss.emit('connection', ws, {url: '/ws/session/missing', bridgeWsAuth: {kind: 'desktop'}})
    assert.equal(ws.closed, 4000)
})

test('WebSocket Session Runtime 缺少边界依赖时立即失败', () => {
    assert.throws(
        () => createWebSocketSessionRuntime({sessions: new Map()}),
        /websocket session dependencies are required/,
    )
})
