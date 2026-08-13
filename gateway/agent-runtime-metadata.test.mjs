import assert from 'node:assert/strict'
import test from 'node:test'
import {buildAgentRuntimeMetadata} from './agent-runtime-metadata.mjs'

test('Agent 元数据展示实际模型、请求档位和职责阶段', () => {
    const metadata = buildAgentRuntimeMetadata({
        id: 'review', agentType: 'reviewer', phase: 'Review', prompt: '检查本轮改动',
        modelRoute: {model: 'gpt-power', source: 'tier', tier: 'power'},
        workflowName: 'final-review', runKey: 'final-review:session-1',
    })
    assert.equal(metadata.actualModel, 'gpt-power')
    assert.equal(metadata.requestedModelTier, 'power')
    assert.equal(metadata.role, 'reviewer')
    assert.equal(metadata.phase, 'Review')
    assert.equal(metadata.required, true)
})

test('普通 Workflow Agent 不冒充父任务完成门禁', () => {
    assert.equal(buildAgentRuntimeMetadata({runKey: 'code-review', label: 'scan'}).required, false)
})
