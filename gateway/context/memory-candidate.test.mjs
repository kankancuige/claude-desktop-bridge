import assert from 'node:assert/strict'
import test from 'node:test'
import {createMemoryCandidateStore} from './memory-candidate.mjs'

function repository() {
    const rows = new Map()
    return {
        rows,
        async put(value) { const row = {...value, projectKey: value.projectKey, metadata: {...value.metadata}}; rows.set(`${row.projectKey}:${row.sourceKey}`, row); return row },
        async list({projectKey, status, limit = 100} = {}) { return [...rows.values()].filter(row => row.projectKey === projectKey && (!status || row.status === status)).slice(0, limit) },
        async get({projectKey, sourceKey}) { return rows.get(`${projectKey}:${sourceKey}`) || null },
        async disable({projectKey, sourceKey}) { const row = rows.get(`${projectKey}:${sourceKey}`); if (!row) return false; row.status = 'disabled'; return true },
    }
}

test('未验证事实不落 candidate，verified fact 审批后才 active', async () => {
    const store = createMemoryCandidateStore({memoryRepository: repository(), now: () => 100})
    const candidates = await store.extractMemoryCandidates({taskId: 't1', projectKey: 'p1', verifiedFacts: [
        {summary: '未验证', verified: false, evidence: ['x']},
        {summary: '已验证规则', verified: true, evidence: [{key: 'test:1'}]},
    ]})
    assert.equal(candidates.length, 1)
    assert.equal((await store.listCandidates({projectKey: 'p1'})).length, 1)
    const active = await store.approveMemoryCandidate({candidateId: candidates[0].candidateId, projectKey: 'p1', actor: 'user', sourceEvidence: ['test:1']})
    assert.equal(active.status, 'active')
    assert.equal((await store.listCandidates({projectKey: 'p1'})).length, 0)
})

test('审批缺少证据时拒绝激活', async () => {
    const store = createMemoryCandidateStore({memoryRepository: repository()})
    const [candidate] = await store.extractMemoryCandidates({taskId: 't1', projectKey: 'p1', verifiedFacts: [{summary: '规则', verified: true, evidence: ['test']} ]})
    await assert.rejects(() => store.approveMemoryCandidate({candidateId: candidate.candidateId, projectKey: 'p1', actor: 'user'}), error => error.code === 'MEMORY_CANDIDATE_APPROVAL_REQUIRED')
})

test('同一项目的重复事实跨会话复用 candidate，不持续膨胀', async () => {
    const store = createMemoryCandidateStore({memoryRepository: repository()})
    const first = await store.extractMemoryCandidates({taskId: 't1', projectKey: 'p1', verifiedFacts: [{summary: '统一使用 UTF-8', verified: true, evidence: ['request:t1']}]})
    const second = await store.extractMemoryCandidates({taskId: 't2', projectKey: 'p1', verifiedFacts: [{summary: '统一使用 UTF-8', verified: true, evidence: ['request:t2']}]})
    assert.equal(first[0].candidateId, second[0].candidateId)
    assert.equal((await store.listCandidates({projectKey: 'p1'})).length, 1)
    assert.equal((await store.listCandidates({projectKey: 'p1'}))[0].metadata.taskId, 't2')
})
