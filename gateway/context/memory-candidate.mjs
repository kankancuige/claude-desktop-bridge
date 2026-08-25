import {createHash} from 'node:crypto'
import {normalizeMemoryMetadata} from './memory-layer.mjs'

function text(value, max = 1000) { return typeof value === 'string' ? value.replace(/[\0\r\n]+/g, ' ').trim().slice(0, max) : '' }
function candidateId(projectKey, fact) {
    const summary = text(fact?.summary || fact?.text).toLowerCase().replace(/\s+/g, ' ')
    return createHash('sha256').update(`${projectKey}|${summary}`).digest('hex').slice(0, 32)
}
function normalizeFact(fact) {
    const summary = text(fact?.summary || fact?.text, 2000)
    const evidence = (Array.isArray(fact?.evidence) ? fact.evidence : Array.isArray(fact?.references) ? fact.references : [])
        .map(item => text(item?.key || item?.sourceKey || item, 240)).filter(Boolean).slice(0, 10)
    return {summary, evidence, verified: fact?.verified === true || fact?.status === 'verified'}
}

/** 未验证事实只能进入 candidate；只有显式 approve 才允许 active。 */
export function createMemoryCandidateStore({memoryRepository, now = () => Date.now()} = {}) {
    if (!memoryRepository?.list || !memoryRepository?.get || !memoryRepository?.put || !memoryRepository?.disable) throw new TypeError('Memory Repository is required')
    async function extractMemoryCandidates({taskId, projectKey, verifiedFacts = [], scope = 'project'} = {}) {
        const task = text(taskId, 240)
        const project = text(projectKey, 240)
        if (!task || !project) throw Object.assign(new TypeError('candidate taskId/projectKey 无效'), {code: 'MEMORY_CANDIDATE_ARGUMENT_INVALID'})
        const candidates = []
        for (const raw of (Array.isArray(verifiedFacts) ? verifiedFacts : [])) {
            const fact = normalizeFact(raw)
            if (!fact.summary || !fact.verified || !fact.evidence.length) continue
            const id = candidateId(project, fact)
            const sourceKey = `candidate/${id}`
            const row = await memoryRepository.put({
                projectKey: project, sourceKey, title: fact.summary.slice(0, 120), body: fact.summary,
                scope, status: 'candidate', metadata: normalizeMemoryMetadata({lifecycle: 'candidate', candidateId: id, taskId: task, evidence: fact.evidence, capture: fact.capture || 'explicit', createdAt: now(), memoryType: 'fact'}, fact.summary), updatedAt: now(),
            })
            candidates.push({candidateId: id, projectKey: project, taskId: task, sourceKey, scope, status: 'candidate', evidence: fact.evidence, summary: fact.summary, row})
        }
        return candidates
    }
    async function listCandidates({projectKey, limit = 100} = {}) {
        return memoryRepository.list({projectKey: text(projectKey, 240), status: 'candidate', limit})
    }
    async function approveMemoryCandidate({candidateId: id, projectKey, actor, sourceEvidence = [], sourceKey = null} = {}) {
        const candidateIdValue = text(id, 64)
        const actorValue = text(actor, 160)
        const evidence = (Array.isArray(sourceEvidence) ? sourceEvidence : []).map(item => text(item?.key || item?.sourceKey || item, 240)).filter(Boolean).slice(0, 10)
        if (!candidateIdValue || !actorValue || !evidence.length) throw Object.assign(new TypeError('审批需要 candidateId、actor 和 sourceEvidence'), {code: 'MEMORY_CANDIDATE_APPROVAL_REQUIRED'})
        const rows = await listCandidates({projectKey, limit: 500})
        const candidate = rows.find(row => row.metadata?.candidateId === candidateIdValue)
        if (!candidate) throw Object.assign(new Error('Memory candidate 不存在'), {code: 'MEMORY_CANDIDATE_NOT_FOUND'})
        const activeKey = text(sourceKey, 240) || `memory/approved-${candidateIdValue}.md`
        const active = await memoryRepository.put({
            projectKey: candidate.projectKey || projectKey, sourceKey: activeKey, title: candidate.title, body: candidate.body || '',
            scope: candidate.scope || 'project', status: 'active', metadata: normalizeMemoryMetadata({... (candidate.metadata || {}), lifecycle: 'active', approvedBy: actorValue, approvedAt: now(), approvalEvidence: evidence}, candidate.body || ''), updatedAt: now(),
        })
        await memoryRepository.disable({projectKey: candidate.projectKey || projectKey, sourceKey: candidate.sourceKey, updatedAt: now()})
        return {...active, candidateId: candidateIdValue, status: 'active'}
    }
    async function rejectMemoryCandidate({candidateId: id, projectKey} = {}) {
        const candidateIdValue = text(id, 64)
        const rows = await listCandidates({projectKey, limit: 500})
        const candidate = rows.find(row => row.metadata?.candidateId === candidateIdValue)
        if (!candidate) return false
        return memoryRepository.disable({projectKey: candidate.projectKey || projectKey, sourceKey: candidate.sourceKey, updatedAt: now()})
    }
    return {extractMemoryCandidates, listCandidates, approveMemoryCandidate, rejectMemoryCandidate}
}

export const extractMemoryCandidates = input => input?.store?.extractMemoryCandidates(input)
export const approveMemoryCandidate = input => input?.store?.approveMemoryCandidate(input)
