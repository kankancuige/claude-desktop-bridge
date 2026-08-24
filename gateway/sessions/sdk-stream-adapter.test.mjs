import assert from 'node:assert/strict'
import test from 'node:test'
import {createSdkStreamAdapter} from './sdk-stream-adapter.mjs'

function createAdapter() {
    return createSdkStreamAdapter({
        getSession: id => id === 'session-1' ? {lastSessionId: 'sdk-1', modelMeta: {label: 'fallback'}, queryOpts: {agents: {reviewer: {description: '审查'}}}} : null,
        lookupModelInfo: model => ({id: model, label: 'Known model'}),
        buildSystemInitEvent: input => ({type: 'system_init', model: input.modelInfo.id, fallback: input.modelMeta.label}),
        buildAgentDescriptor: (agentType, input) => ({purpose: agentType, task: input.description || ''}),
        compactBoundaryToEvent: () => ({type: 'context_compacted'}),
        isSyntheticCompactSummary: () => false,
        isInternalWorkflowResultText: text => text === 'internal',
        isAutoContinuationPrompt: text => text === 'continue-internal',
        classifyTaskResult: input => ({outcome: input.is_error ? 'failed' : 'succeeded'}),
        canResumeTask: (result, hasSession) => result.outcome === 'succeeded' && hasSession,
        now: () => 123,
    })
}

test('SDK init、Agent 进度和 stream event 转为稳定桌面事件', () => {
    const adapter = createAdapter()
    assert.deepEqual(adapter.toClientEvent({type: 'system', subtype: 'init', model: 'model-a'}, 'session-1'), {
        type: 'system_init', model: 'model-a', fallback: 'fallback',
    })
    assert.deepEqual(adapter.toClientEvent({
        type: 'system', subtype: 'task_started', task_id: 'agent-1', subagent_type: 'reviewer', description: '检查改动',
    }, 'session-1'), {
        type: 'subagent_start', agentId: 'agent-1', toolUseId: null, agentType: 'reviewer',
        description: '检查改动', purpose: 'reviewer', task: '检查改动', ts: 123,
    })
    assert.deepEqual(adapter.toClientEvent({
        type: 'stream_event', event: {type: 'content_block_delta', index: 2, delta: {type: 'text_delta', text: 'ok'}},
    }, 'session-1'), {type: 'text_delta', text: 'ok'})
})

test('内部用户消息不会泄漏到界面，result 只使用会话连续性推导可续接', () => {
    const adapter = createAdapter()
    assert.equal(adapter.toClientEvent({type: 'user', message: {content: [{type: 'text', text: 'internal'}]}}, 'session-1'), null)
    assert.equal(adapter.toClientEvent({type: 'user', message: {content: [{type: 'text', text: 'continue-internal'}]}}, 'session-1'), null)
    assert.deepEqual(adapter.toClientEvent({type: 'result', is_error: false, duration_ms: 5, num_turns: 2, result: 'done'}, 'session-1'), {
        type: 'result', subtype: undefined, duration_ms: 5, is_error: false, num_turns: 2,
        result: 'done', usage: undefined, modelUsage: undefined, outcome: 'succeeded', resumable: true,
    })
})

test('SDK 工具、思考、错误和未知事件保持明确边界', () => {
    const adapter = createAdapter()
    assert.deepEqual(adapter.toClientEvent({
        type: 'stream_event', event: {
            type: 'content_block_start', index: 1,
            content_block: {type: 'tool_use', id: 'tool-1', name: 'Bash', input: {}},
        },
    }, 'session-1'), {
        type: 'tool_use_start', index: 1, tool_name: 'Bash', tool_use_id: 'tool-1', input: {},
    })
    assert.deepEqual(adapter.toClientEvent({
        type: 'stream_event', event: {
            type: 'content_block_delta', index: 2,
            delta: {type: 'thinking_delta', thinking: '分析'},
        },
    }, 'session-1'), {type: 'thinking_delta', index: 2, thinking: '分析'})
    assert.deepEqual(adapter.toClientEvent({
        type: 'assistant', message: {role: 'assistant', content: []}, error: 'provider error',
    }, 'session-1'), {
        type: 'assistant_message', message: {role: 'assistant', content: []}, error: 'provider error',
    })
    assert.deepEqual(adapter.toClientEvent({
        type: 'tool_progress', tool_use_id: 'tool-1', tool_name: 'Bash', elapsed_time_seconds: 2,
    }, 'session-1'), {
        type: 'tool_progress', tool_use_id: 'tool-1', tool_name: 'Bash', elapsed_time_seconds: 2,
    })
    assert.equal(adapter.toClientEvent({type: 'unknown_sdk_event'}, 'session-1'), null)
})
