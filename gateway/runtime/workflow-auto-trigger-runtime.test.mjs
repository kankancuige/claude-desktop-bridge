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

test('自动 Workflow 将会话权限传给子 Agent', async () => {
    const calls = []
    const sessionId = 'session-1'
    const runtime = createWorkflowAutoTriggerRuntime({
        loadWfConfig: () => ({enabled: true, modelTiers: {}}),
        shouldAutoTriggerWorkflow: () => true,
        classifyContextProfile: () => 'full',
        listWorkflows: () => [{name: 'code-review', enabled: true}],
        presetRunState: () => 'wf-1',
        sessions: new Map([[sessionId, {workDir: 'D:/project', permissionMode: 'bypassPermissions'}]]),
        createTaskWorkflowGate: () => ({active: new Set()}),
        attachTaskWorkflow() {},
        broadcastTaskLifecycle() {},
        broadcast() {},
        resolveWorkflowFinalReviewTier: () => 'balanced',
        runWfScript: async (...args) => { calls.push(args) },
    })
    await runtime.autoTriggerWorkflow(sessionId, '请审查这段代码', {action: 'review', contextProfile: 'full', workflow: 'code-review'})
    assert.equal(calls[0][2]._permissionMode, 'bypassPermissions')
})
