import test from 'node:test'
import assert from 'node:assert/strict'
import {classifyWeChatSendStatus} from './wechat-send-status.mjs'

test('微信发送状态只保留 HTTP 和平台数值返回码', () => {
    assert.deepEqual(classifyWeChatSendStatus({ok: true, status: 200}, {ret: 0}), {
        ok: true, status: 200, ret: 0, errcode: null,
    })
    assert.deepEqual(classifyWeChatSendStatus({ok: false, status: 401}, {ret: 0}), {
        ok: false, status: 401, ret: 0, errcode: null,
    })
    assert.deepEqual(classifyWeChatSendStatus({ok: true, status: 200}, {ret: -14, errcode: -14}), {
        ok: false, status: 200, ret: -14, errcode: -14,
    })
})
