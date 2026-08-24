import test from 'node:test'
import assert from 'node:assert/strict'
import {createWeChatChunkRuntime} from './wechat-chunk-runtime.mjs'

test('微信分段不切断 UTF-8 字符并按顺序发送', async () => {
    const requests = []
    const runtime = createWeChatChunkRuntime({maxBytes: 10, markerReserve: 0, delay: async () => {}, fetchImpl: async (url, options) => {
        requests.push(JSON.parse(options.body).msg.item_list[0].text_item.text)
        return {ok: true, async json() { return {ret: 0} }}
    }})
    assert.deepEqual(runtime.splitByBytes('中文A', 6), ['中文', 'A'])
    const result = await runtime.sendWeChatChunks('https://example/', 'token', 'user', '', '中文A')
    assert.equal(result.sent, true)
    assert.deepEqual(requests, ['中文A'])
})
