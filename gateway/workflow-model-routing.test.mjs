import test from 'node:test'
import assert from 'node:assert/strict'
import {assertWorkflowAgentModel, inferWorkflowAgentTier, resolveWorkflowAgentModel, resolveWorkflowFinalReviewTier, resolveWorkflowPermissionMode, shouldAutoTriggerFinalReview, shouldAutoTriggerWorkflow} from './workflow-model-routing.mjs'

test('显式 Agent 模型优先于 Workflow 和职责档位', () => {
    assert.deepEqual(resolveWorkflowAgentModel({
        model: 'vendor-custom', modelTier: 'light', workflowTier: 'power',
        modelTiers: {light: 'light-model', power: 'power-model'},
    }), {model: 'vendor-custom', source: 'explicit', tier: null})
})

test('固定模式覆盖 Workflow 内部模型声明', () => {
    assert.deepEqual(resolveWorkflowAgentModel({
        fixedModel: 'user-fixed', model: 'workflow-explicit', modelTier: 'power',
        modelTiers: {power: 'power-model'},
    }), {model: 'user-fixed', source: 'fixed', tier: null})
})

test('最终复核父级强制 Power，但固定模式仍优先', () => {
    assert.deepEqual(resolveWorkflowAgentModel({
        forcedModelTier: 'power', model: 'workflow-explicit', modelTier: 'balanced',
        modelTiers: {balanced: 'balanced-model', power: 'power-model'},
    }), {model: 'power-model', source: 'tier', tier: 'power'})
    assert.deepEqual(resolveWorkflowAgentModel({
        fixedModel: 'user-fixed', forcedModelTier: 'power', modelTiers: {power: 'power-model'},
    }), {model: 'user-fixed', source: 'fixed', tier: null})
})

test('旧 Workflow 无 modelTier 时按 phase 和 label 推导职责', () => {
    assert.equal(inferWorkflowAgentTier({label: 'risk-classify', phase: 'Size', workflowTier: 'power'}), 'light')
    assert.equal(inferWorkflowAgentTier({label: 'review:bugs', phase: 'Review', workflowTier: 'power'}), 'balanced')
    assert.equal(inferWorkflowAgentTier({label: 'verify:file', phase: 'Verify', workflowTier: 'balanced'}), 'power')
})

test('未显式模型按职责档位解析，缺失时报告未配置', () => {
    assert.deepEqual(resolveWorkflowAgentModel({
        modelTier: 'power', workflowTier: 'balanced', modelTiers: {power: 'power-model'},
    }), {model: 'power-model', source: 'tier', tier: 'power'})
    assert.deepEqual(resolveWorkflowAgentModel({
        modelTier: 'light', modelTiers: {},
    }), {model: null, source: 'unconfigured', tier: 'light'})
})

test('高风险最终复核强制 Power', () => {
    assert.equal(resolveWorkflowFinalReviewTier({risk: 'critical', requestedTier: 'balanced'}), 'power')
    assert.equal(resolveWorkflowFinalReviewTier({risk: 'medium', requestedTier: 'balanced'}), 'balanced')
})

test('Power Agent 缺少档位模型时明确失败，不回退父会话模型', () => {
    const route = resolveWorkflowAgentModel({modelTier: 'power', modelTiers: {balanced: 'model-balanced'}})
    assert.throws(() => assertWorkflowAgentModel(route), error => error.code === 'WORKFLOW_POWER_MODEL_REQUIRED')
})

test('实施任务不并行启动重复写入 Workflow，只读辅助任务可以自动启动', () => {
    assert.equal(shouldAutoTriggerWorkflow({action: 'implement', contextProfile: 'full', workflow: 'generate-critic-fix'}), false)
    assert.equal(shouldAutoTriggerWorkflow({action: 'review', contextProfile: 'focused', workflow: 'code-review'}), true)
    assert.equal(shouldAutoTriggerWorkflow({action: 'query', contextProfile: 'light', workflow: 'none'}), false)
})

test('最终复核只在策略要求且成功回合产生真实差异后启动', () => {
    const decision = {finalReview: 'power'}
    assert.equal(shouldAutoTriggerFinalReview({decision, outcome: 'succeeded', changedFileCount: 2}), true)
    assert.equal(shouldAutoTriggerFinalReview({decision, outcome: 'failed', changedFileCount: 2}), false)
    assert.equal(shouldAutoTriggerFinalReview({decision, outcome: 'succeeded', changedFileCount: 0}), false)
    assert.equal(shouldAutoTriggerFinalReview({decision: {finalReview: 'none'}, outcome: 'succeeded', changedFileCount: 2}), false)
})

test('父流程只读权限覆盖 Agent 的写入权限', () => {
    assert.equal(resolveWorkflowPermissionMode({parentPermissionMode: 'plan', agentPermissionMode: 'acceptEdits'}), 'plan')
    assert.equal(resolveWorkflowPermissionMode({agentPermissionMode: 'default'}), 'default')
    assert.equal(resolveWorkflowPermissionMode({}), 'acceptEdits')
})
