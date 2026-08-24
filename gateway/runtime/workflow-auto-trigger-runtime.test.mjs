import test from 'node:test'
import assert from 'node:assert/strict'
import {createWorkflowAutoTriggerRuntime} from './workflow-auto-trigger-runtime.mjs'

test('Workflow Auto Trigger Runtime 识别明确审查意图并跳过简单问答', () => {
    const runtime = createWorkflowAutoTriggerRuntime({
        loadWfConfig: () => ({enabled: true}), sessions: new Map(), runWfScript: async () => null,
    })
    assert.equal(runtime.analyzeMessageForWorkflow('请帮我审查这段代码'), 'code-review')
    assert.equal(runtime.analyzeMessageForWorkflow('你好'), '__skip__')
    assert.equal(runtime.analyzeMessageForWorkflow('普通实现任务'), null)
})

test('Workflow Auto Trigger Runtime 缺少运行边界时立即失败', () => {
    assert.throws(() => createWorkflowAutoTriggerRuntime(), /dependencies are required/)
})
