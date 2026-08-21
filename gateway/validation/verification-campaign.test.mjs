import assert from 'node:assert/strict'
import test from 'node:test'
import {createVerificationAdapterRegistry} from './verification-adapter.mjs'
import {compareVerificationRuns, createVerificationCampaignService} from './verification-campaign.mjs'

test('单次和重复场景产生证据与成功率', async () => {
    let calls = 0
    const registry = createVerificationAdapterRegistry([{id: 'test', type: 'test', execute: async () => ({passed: ++calls > 0}), timeoutMs: 1000}])
    const service = createVerificationCampaignService({registry})
    const campaign = service.create({taskId: 't', adapterId: 'test', scenarios: [{id: 's1'}], rounds: 2})
    const result = await service.runVerificationCampaign(campaign.campaignId)
    assert.equal(result.status, 'passed')
    assert.equal(result.candidate.length, 2)
    assert.equal(result.evidenceLevel, 'L4')
})

test('基线候选对比识别新回归并聚类失败', () => {
    const comparison = compareVerificationRuns([{passed: false, exitCode: 1, stderr: 'old 123'}], [{passed: false, exitCode: 2, stderr: 'new 456'}, {passed: false, exitCode: 2, stderr: 'new 999'}])
    assert.equal(comparison.regressionDetected, true)
    assert.equal(comparison.failureFingerprints.length, 1)
})

test('取消和环境阻塞不能显示通过', async () => {
    const registry = createVerificationAdapterRegistry([{id: 'env', type: 'runtime', execute: async () => { throw new Error('environment not found') }}])
    const service = createVerificationCampaignService({registry})
    const campaign = service.create({adapterId: 'env', scenarios: [{}]})
    assert.equal((await service.runVerificationCampaign(campaign.campaignId)).status, 'blocked_environment')
})

test('Campaign 逐场景持久化并在重启后把运行态降级为可恢复不足', async () => {
    const persisted = []
    const registry = createVerificationAdapterRegistry([{id: 'test', type: 'test', execute: async input => ({passed: true, command: input.id})}])
    const first = createVerificationCampaignService({registry, persist: value => persisted.push(value)})
    const campaign = first.create({taskId: 'task-1', adapterId: 'test', scenarios: [{id: 'a'}, {id: 'b'}]})
    const result = await first.runVerificationCampaign(campaign.campaignId)
    assert.equal(result.candidate.length, 2)
    assert.ok(persisted.some(item => item.status === 'candidate_running' && item.candidate.length === 1))

    const second = createVerificationCampaignService({registry})
    const restored = second.restore({...result, status: 'candidate_running'})
    assert.equal(restored.status, 'inconclusive')
    assert.equal(restored.errorCode, 'VERIFICATION_INTERRUPTED')
    assert.equal(second.list({taskId: 'task-1'}).length, 1)
})

test('忽略 AbortSignal 的适配器仍受阶段 timeout 约束', async () => {
    const registry = createVerificationAdapterRegistry([{id: 'hang', type: 'runtime', timeoutMs: 100, execute: async () => new Promise(() => {})}])
    const service = createVerificationCampaignService({registry})
    const campaign = service.create({taskId: 'task-timeout', adapterId: 'hang', scenarios: [{id: 'hang'}]})
    const result = await service.runVerificationCampaign(campaign.campaignId)
    assert.equal(result.status, 'inconclusive')
})
