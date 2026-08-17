import assert from 'node:assert/strict'
import test from 'node:test'
import {mapStreamEvent} from './stream-event-mapper.mjs'

test('保留工具块索引并转换工具输入分片', () => {
    assert.deepEqual(mapStreamEvent({
        type: 'content_block_start',
        index: 2,
        content_block: {type: 'tool_use', id: 'tool-1', name: 'Bash', input: {}},
    }), {
        type: 'tool_use_start',
        index: 2,
        tool_name: 'Bash',
        tool_use_id: 'tool-1',
        input: {},
    })

    assert.deepEqual(mapStreamEvent({
        type: 'content_block_delta',
        index: 2,
        delta: {type: 'input_json_delta', partial_json: '{"command":"pnpm test"}'},
    }), {
        type: 'tool_input_delta',
        index: 2,
        partial_json: '{"command":"pnpm test"}',
    })

    assert.deepEqual(mapStreamEvent({type: 'content_block_stop', index: 2}), {
        type: 'content_block_stop',
        index: 2,
    })
})

test('未知流式事件不污染会话消息', () => {
    assert.equal(mapStreamEvent({type: 'content_block_delta', delta: {type: 'unknown'}}), null)
    assert.equal(mapStreamEvent(null), null)
})
