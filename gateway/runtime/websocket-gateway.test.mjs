import test from 'node:test'
import assert from 'node:assert/strict'
import {createWebSocketGateway} from './websocket-gateway.mjs'

function fixture() {
    const listeners = new Map()
    const server = {on(name, fn) {listeners.set(name, fn)}, off(name, fn) {if (listeners.get(name) === fn) listeners.delete(name)}}
    const emitted = []
    const wss = {
        handleUpgrade(req, socket, head, callback) {callback({id: 'ws'}, req, head)},
        emit(name, ws, req) {emitted.push({name, ws, req})},
    }
    return {server, wss, listeners, emitted}
}

test('WebSocket upgrade 拒绝无 token、非法路径和 IM 桌面冒用', () => {
    const f = fixture()
    createWebSocketGateway({httpServer: f.server, wss: f.wss, port: 3456, extractToken: () => null, authenticate: () => null})
    const socket = {writes: [], write(value) {this.writes.push(value)}, destroy() {this.destroyed = true}}
    f.listeners.get('upgrade')({url: '/ws/s1', headers: {}}, socket, Buffer.alloc(0))
    assert.equal(socket.writes[0].startsWith('HTTP/1.1 401'), true)
    assert.equal(socket.destroyed, true)
})

test('WebSocket upgrade 通过认证后把认证上下文交给 wss', () => {
    const f = fixture()
    createWebSocketGateway({
        httpServer: f.server,
        wss: f.wss,
        port: 3456,
        extractToken: () => 'token',
        authenticate: token => token === 'token' ? {kind: 'desktop'} : null,
    })
    const req = {url: '/ws/s1?source=desktop', headers: {}}
    f.listeners.get('upgrade')(req, {}, Buffer.alloc(0))
    assert.equal(req.bridgeWsAuth.kind, 'desktop')
    assert.equal(f.emitted.length, 1)
})
