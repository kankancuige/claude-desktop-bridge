import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionBroadcastRuntime} from './session-broadcast-runtime.mjs'

test('Session Broadcast Runtime 向连接客户端发送广播', () => {
    const sent = []
    const runtime = createSessionBroadcastRuntime({
        sessions: new Map([['s1', {clients: new Set([{readyState: 1, send: value => sent.push(value)}])}]]),
        getTaskCommands: () => ({publish() {}}), reportImProgressEvent() {}, shouldDeliverTurnEvent: () => true,
    })
    runtime.broadcastDesktop('s1', {type: 'ok'})
    assert.deepEqual(JSON.parse(sent[0]), {type: 'ok'})
})

test('Session Broadcast Runtime 缺少依赖时立即失败', () => {
    assert.throws(() => createSessionBroadcastRuntime(), /dependencies are required/)
})
