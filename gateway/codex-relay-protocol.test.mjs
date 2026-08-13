import test from 'node:test'
import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import {createResponsesSseTranslator, fromResponsesJson, toResponsesRequest, translateResponsesSse} from './codex-relay-protocol.mjs'

test('Anthropic Messages 转 Responses input/tools', () => {
    const request = toResponsesRequest({
        model: 'claude-code-codex',
        max_tokens: 900,
        system: [{type: 'text', text: 'You are a coding agent.'}],
        messages: [
            {role: 'user', content: [{type: 'text', text: '读取文件'}, {type: 'image', source: {type: 'base64', media_type: 'image/png', data: 'abc'}}]},
            {role: 'assistant', content: [{type: 'tool_use', id: 'call-1', name: 'Read', input: {path: 'README.md'}}]},
            {role: 'user', content: [{type: 'tool_result', tool_use_id: 'call-1', content: 'file content'}]},
        ],
        tools: [{name: 'Read', description: 'read file', input_schema: {type: 'object', properties: {path: {type: 'string'}}}}],
        stream: true,
    }, 'gpt-5.6-sol')
    assert.equal(request.model, 'gpt-5.6-sol')
    assert.equal(request.instructions, 'You are a coding agent.')
    assert.equal(request.stream, true)
    assert.equal(request.max_output_tokens, 900)
    assert.equal(request.input[0].role, 'user')
    assert.equal(request.input[0].content[1].type, 'input_image')
    assert.deepEqual(request.input[1], {type: 'function_call', call_id: 'call-1', name: 'Read', arguments: '{"path":"README.md"}'})
    assert.deepEqual(request.input[2], {type: 'function_call_output', call_id: 'call-1', output: 'file content'})
    assert.equal(request.tools[0].type, 'function')
})

test('Claude API Skill 内部文档不会原样转发给 Codex', () => {
    const request = toResponsesRequest({
        messages: [
            {role: 'assistant', content: [{type: 'tool_use', id: 'skill-1', name: 'Skill', input: {skill: 'claude-api'}}]},
            {role: 'user', content: [{type: 'tool_result', tool_use_id: 'skill-1', content: 'Base directory for this skill: C:\\Temp\\claude-api\\n# Building LLM-Powered Applications with Claude\\nOutput Requirement'}]},
        ],
    }, 'gpt-5.6-sol')
    const output = request.input.find(item => item.type === 'function_call_output')
    assert.ok(output)
    assert.doesNotMatch(output.output, /Base directory for this skill|Output Requirement/)
    assert.match(output.output, /internal skill/i)
})

test('Responses JSON 转 Anthropic tool_use', () => {
    const message = fromResponsesJson({
        id: 'resp-1', model: 'gpt-5.6-sol', status: 'completed',
        output: [
            {type: 'message', content: [{type: 'output_text', text: '先读取文件'}]},
            {type: 'function_call', call_id: 'call-2', name: 'Read', arguments: '{"path":"README.md"}'},
        ],
        usage: {input_tokens: 12, output_tokens: 8},
    }, 'gpt-5.6-sol')
    assert.equal(message.stop_reason, 'tool_use')
    assert.deepEqual(message.content[1].input, {path: 'README.md'})
    assert.deepEqual(message.usage, {input_tokens: 12, output_tokens: 8})
})

test('Responses reasoning summary JSON is exposed as Anthropic thinking', () => {
    const message = fromResponsesJson({
        id: 'resp-reasoning-1', model: 'gpt-5.6-sol', status: 'completed',
        output: [
            {type: 'reasoning', summary: [{type: 'summary_text', text: '先检查输入边界。'}]},
            {type: 'message', content: [{type: 'output_text', text: '已完成。'}]},
        ],
    }, 'gpt-5.6-sol')
    assert.deepEqual(message.content[0], {type: 'thinking', thinking: '先检查输入边界。'})
    assert.deepEqual(message.content[1], {type: 'text', text: '已完成。'})
})

test('Responses JSON failed status is not converted into a successful message', () => {
    assert.throws(() => fromResponsesJson({status: 'failed', error: {message: 'upstream failed'}}), /upstream failed/)
})

test('Responses SSE 转 Anthropic SSE，并保持工具事件顺序', async () => {
    const upstream = [
        'event: response.created\ndata: {"response":{"id":"resp-2","model":"gpt-5.6-sol"}}\n\n',
        'event: response.output_text.delta\ndata: {"output_index":0,"content_index":0,"delta":"hello"}\n\n',
        'event: response.output_item.added\ndata: {"output_index":1,"item":{"type":"function_call","call_id":"call-3","name":"Read"}}\n\n',
        'event: response.function_call_arguments.delta\ndata: {"output_index":1,"delta":"{\\"path\\":\\"README.md\\"}"}\n\n',
        'event: response.output_item.done\ndata: {"output_index":1}\n\n',
        'event: response.completed\ndata: {"response":{"model":"gpt-5.6-sol","usage":{"output_tokens":9}}}\n\n',
    ].map(value => Buffer.from(value))
    let output = ''
    for await (const frame of translateResponsesSse(Readable.from(upstream), 'gpt-5.6-sol')) output += frame
    assert.match(output, /event: message_start/)
    assert.match(output, /"type":"text_delta"/)
    assert.match(output, /"type":"input_json_delta"/)
    assert.match(output, /"stop_reason":"tool_use"/)
    assert.match(output, /event: message_stop/)
    assert.equal((output.match(/event: content_block_stop/g) || []).length, 2)
})

test('SSE translator can be used directly for an added text item', () => {
    const translator = createResponsesSseTranslator('gpt-5.6-sol')
    const output = translator.translate('response.output_item.added', {output_index: 0, item: {type: 'message'}})
    assert.match(output, /content_block_start/)
})

test('Responses reasoning summary SSE becomes thinking deltas', async () => {
    const upstream = [
        'event: response.created\ndata: {"response":{"id":"resp-reasoning-2","model":"gpt-5.6-sol"}}\n\n',
        'event: response.output_item.added\ndata: {"output_index":0,"item":{"type":"reasoning","id":"reason-1"}}\n\n',
        'event: response.reasoning_summary_text.delta\ndata: {"output_index":0,"summary_index":0,"item_id":"reason-1","delta":"先检查"}\n\n',
        'event: response.reasoning_summary_text.delta\ndata: {"output_index":0,"summary_index":0,"item_id":"reason-1","delta":"输入。"}\n\n',
        'event: response.reasoning_summary_text.done\ndata: {"output_index":0,"summary_index":0}\n\n',
        'event: response.output_item.done\ndata: {"output_index":0}\n\n',
        'event: response.completed\ndata: {"response":{"model":"gpt-5.6-sol","usage":{"output_tokens":9}}}\n\n',
    ].map(value => Buffer.from(value))
    let output = ''
    for await (const frame of translateResponsesSse(Readable.from(upstream), 'gpt-5.6-sol')) output += frame
    assert.match(output, /"type":"thinking"/)
    assert.match(output, /"type":"thinking_delta","thinking":"先检查"/)
    assert.match(output, /"type":"thinking_delta","thinking":"输入。"/)
    assert.equal((output.match(/event: content_block_stop/g) || []).length, 1)
})

test('SSE translator rejects a truncated response without completion', async () => {
    await assert.rejects(
        (async () => {
            for await (const _frame of translateResponsesSse(Readable.from([
                Buffer.from('event: response.created\ndata: {"response":{"id":"resp-truncated"}}\n\n'),
            ]), 'gpt-5.6-sol')) {}
        })(),
        /ended before response\.completed/
    )
})
