import test from 'node:test'
import assert from 'node:assert/strict'
import {
    assertAgentCapabilities,
    normalizeAgentCapabilities,
    requirementsForAgentStart,
} from './agent-capabilities.mjs'

test('能力描述只保留稳定布尔字段', () => {
    assert.deepEqual(normalizeAgentCapabilities({writable: true, resumable: 1, unknown: true}), {
        writable: true,
        resumable: false,
        modelOverride: false,
        structuredOutput: false,
        toolFiltering: false,
        continuation: false,
    })
})

test('缺少能力时在 Provider 启动前返回稳定错误', () => {
    assert.throws(
        () => assertAgentCapabilities({writable: true}, {writable: true, structuredOutput: true}, {provider: 'agent/test'}),
        error => error.code === 'AGENT_CAPABILITY_UNSUPPORTED'
            && error.capability === 'structuredOutput'
            && error.provider === 'agent/test',
    )
})

test('调用参数被转换为显式能力需求', () => {
    assert.deepEqual(requirementsForAgentStart({
        options: {permissionMode: 'acceptEdits', resume: 'sdk-1', model: 'power-model', allowedTools: ['Read']},
        structuredOutput: true,
    }), {
        writable: true,
        resumable: true,
        modelOverride: true,
        structuredOutput: true,
        toolFiltering: true,
        continuation: true,
    })
})
