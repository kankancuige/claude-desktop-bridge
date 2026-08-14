import test from 'node:test'
import assert from 'node:assert/strict'
import {buildSystemInitEvent} from './session-init-event.mjs'

test('system_init 明确区分 Gateway ID 和 SDK 历史会话 ID', () => {
    const event = buildSystemInitEvent({
        sdkMsg: {session_id: 'sdk-1', cwd: 'D:/work', model: 'demo', tools: ['Read']},
        gatewaySessionId: 'gateway-1',
        modelInfo: {contextWindow: 200000, pricing: null},
        modelMeta: null,
    })
    assert.equal(event.sessionId, 'gateway-1')
    assert.equal(event.historySessionId, 'sdk-1')
})

test('system_init 没有 SDK ID 时不会伪造历史会话 ID', () => {
    const event = buildSystemInitEvent({
        sdkMsg: {cwd: 'D:/work', model: 'demo'},
        gatewaySessionId: 'gateway-1',
        modelInfo: {contextWindow: null, pricing: null},
        modelMeta: {contextWindow: 32000, pricing: {inputPrice: 1}},
    })
    assert.equal(event.historySessionId, null)
    assert.equal(event.contextWindow, 32000)
})
