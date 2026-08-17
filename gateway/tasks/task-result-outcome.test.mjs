import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildIncompleteMirrorText,
    classifyTaskResult,
    looksLikeIncompleteTransportFailure,
} from './task-result-outcome.mjs'

test('success is the only successful task outcome', () => {
    assert.deepEqual(classifyTaskResult({subtype: 'success', is_error: false}), {
        outcome: 'succeeded',
        continuationReason: null,
        incomplete: false,
    })
})
test('中转站将断流错误包装为 success 文本时仍判定为执行失败', () => {
    assert.deepEqual(classifyTaskResult({
        subtype: 'success', is_error: false,
        finalText: 'API Error: Connection closed mid-response. The response above may be incomplete.',
    }), {
        outcome: 'failed',
        continuationReason: 'execution_error',
        incomplete: false,
    })
})
test('断流文本识别只匹配明确的连接中断提示', () => {
    assert.equal(looksLikeIncompleteTransportFailure('Connection closed mid-response'), true)
    assert.equal(looksLikeIncompleteTransportFailure('普通任务已完成'), false)
})
test('max turns is incomplete rather than completed', () => {
    assert.deepEqual(classifyTaskResult({subtype: 'error_max_turns', is_error: true}), {
        outcome: 'incomplete',
        continuationReason: 'max_turns',
        incomplete: true,
    })
})

test('budget and execution errors remain distinct failures', () => {
    assert.equal(classifyTaskResult({subtype: 'error_max_budget_usd', is_error: true}).continuationReason, 'max_budget')
    assert.equal(classifyTaskResult({subtype: 'error_during_execution', is_error: true}).continuationReason, 'execution_error')
    assert.equal(classifyTaskResult({subtype: 'future_error', is_error: true}).continuationReason, 'unknown_error')
})

test('incomplete IM text never claims success', () => {
    const result = buildIncompleteMirrorText('已修改两个文件。', {
        outcome: 'incomplete',
        continuationReason: 'max_turns',
    })
    assert.match(result, /任务尚未完成/)
    assert.match(result, /继续执行/)
    assert.doesNotMatch(result, /任务完成/)
})
