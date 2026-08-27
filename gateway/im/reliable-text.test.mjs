import test from 'node:test'
import assert from 'node:assert/strict'
import {sendTextParts} from './reliable-text.mjs'

test('分段发送按顺序节流，单段失败不阻断后续段', async () => {
    const sent = []
    const delays = []
    const result = await sendTextParts({
        text: 'ignored',
        split: () => ['第一段', '第二段', '第三段'],
        delayMs: 400,
        delay: async ms => delays.push(ms),
        sendPart: async (content, index) => {
            sent.push(content)
            return index === 1 ? {sent: false, queued: true, error: 'send_failed'} : {sent: true, queued: false}
        },
    })
    assert.deepEqual(sent, ['【1/3】第一段', '【2/3】第二段', '【3/3】第三段'])
    assert.deepEqual(delays, [400, 400])
    assert.deepEqual(result, {sent: false, queued: true, error: 'send_failed', parts: 3})
})

test('空文本不产生发送调用', async () => {
    let calls = 0
    const result = await sendTextParts({text: '', split: () => [], sendPart: async () => { calls++ }})
    assert.equal(calls, 0)
    assert.deepEqual(result, {sent: true, queued: false, error: '', parts: 0})
})
