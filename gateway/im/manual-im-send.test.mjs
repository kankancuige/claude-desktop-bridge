import test from 'node:test'
import assert from 'node:assert/strict'
import {sendManualImText} from './manual-im-send.mjs'

test('主动 IM 发送复用运行中适配器的可靠投递链', async () => {
    const calls = []
    const result = await sendManualImText({
        hook: {
            sendToUser: async (...args) => {
                calls.push(args)
                return {sent: true, queued: false, parts: 2}
            },
        },
        platform: 'wechat',
        userId: 'test-user',
        text: '验收消息',
        notificationId: 'manual-test',
    })

    assert.deepEqual(calls, [[
        'manual-wechat-delivery', '验收消息', 'test-user', 'manual-test',
    ]])
    assert.deepEqual(result, {sent: true, queued: false, parts: 2, error: undefined})
})

test('主动 IM 发送在适配器缺失或投递失败时返回可处理状态', async () => {
    assert.deepEqual(await sendManualImText({
        hook: null, platform: 'wechat', userId: 'test-user', text: '验收消息', notificationId: 'manual-test',
    }), {sent: false, queued: false, parts: 0, error: 'adapter_unavailable'})

    assert.deepEqual(await sendManualImText({
        hook: {sendToUser: async () => ({sent: false, queued: true, parts: 1, error: 'send_failed'})},
        platform: 'wechat', userId: 'test-user', text: '验收消息', notificationId: 'manual-test',
    }), {sent: false, queued: true, parts: 1, error: 'send_failed'})
})
