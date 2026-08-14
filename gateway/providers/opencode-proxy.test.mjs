import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import {readLimitedNodeStream, toAnthropicSse, translateBody, translateResponse} from './opencode-proxy.mjs'

const upstreamRequest = translateBody({
    model: 'deepseek-v4-pro',
    stream: true,
    max_tokens: 100,
    messages: [{role: 'user', content: 'hello'}],
})
assert.equal(upstreamRequest.stream, false)
assert.equal(upstreamRequest.messages[0].content, 'hello')

const translated = translateResponse({
    id: 'chat-1',
    choices: [{
        finish_reason: 'tool_calls',
        message: {
            content: '先检查文件',
            tool_calls: [{id: 'tool-1', function: {name: 'Read', arguments: '{"path":"README.md"}'}}],
        },
    }],
    usage: {prompt_tokens: 12, completion_tokens: 8},
}, 'deepseek-v4-pro')
assert.equal(translated.stop_reason, 'tool_use')
assert.deepEqual(translated.content[1].input, {path: 'README.md'})

const sse = toAnthropicSse(translated)
const frames = sse.trim().split('\n\n')
assert.equal(frames[0].startsWith('event: message_start\n'), true)
assert.equal(frames.some(frame => frame.includes('"type":"text_delta"') && frame.includes('先检查文件')), true)
assert.equal(frames.some(frame => frame.includes('"type":"input_json_delta"') && frame.includes('README.md')), true)
assert.equal(frames.at(-1), 'event: message_stop\ndata: {"type":"message_stop"}')

const invalidTool = translateResponse({
    choices: [{finish_reason: 'tool_calls', message: {tool_calls: [
        {id: 'tool-2', function: {name: 'Read', arguments: '{broken'}},
    ]}}],
}, 'deepseek-v4-pro')
assert.deepEqual(invalidTool.content[0].input, {})

assert.equal((await readLimitedNodeStream(Readable.from([Buffer.from('abc')]), 3)).toString(), 'abc')
const oversizedStream = Readable.from([Buffer.from('abcd')])
await assert.rejects(
    readLimitedNodeStream(oversizedStream, 3),
    {statusCode: 413},
)
assert.equal(oversizedStream.destroyed, false)

console.log('opencode-proxy tests passed')
