import assert from 'node:assert/strict'
import test from 'node:test'
import {basename} from 'node:path'
import {createMemoryCandidateStore} from '../context/memory-candidate.mjs'
import {createMemoryRoutes} from './memory-routes.mjs'

function response() {
    return {
        status: 0,
        headers: {},
        writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers) },
        end(body) { this.body = body },
    }
}

function repository() {
    const rows = new Map()
    return {
        rows,
        async put(value) {
            const row = {...value, metadata: {...(value.metadata || {})}}
            rows.set(`${row.projectKey}:${row.sourceKey}`, row)
            return row
        },
        async list({projectKey, status, limit = 100} = {}) {
            return [...rows.values()].filter(row => row.projectKey === projectKey && (!status || row.status === status)).slice(0, limit)
        },
        async get({projectKey, sourceKey}) { return rows.get(`${projectKey}:${sourceKey}`) || null },
        async disable({projectKey, sourceKey}) {
            const row = rows.get(`${projectKey}:${sourceKey}`)
            if (!row) return false
            row.status = 'disabled'
            return true
        },
    }
}

function routeWith(store, {identity = null, owns = true} = {}) {
    return createMemoryRoutes({
        memoryCandidateStore: store,
        getAdapterIdentity: () => identity,
        adapterOwnsProject: () => owns,
        safeDecodeURIComponent: value => decodeURIComponent(value),
        basename,
        readBody: async req => req.body || {},
        log: {warn() {}},
    })
}

test('Memory candidate 路由支持列表、审批和脱敏返回', async () => {
    const store = createMemoryCandidateStore({memoryRepository: repository(), now: () => 100})
    const [candidate] = await store.extractMemoryCandidates({taskId: 'task-1', projectKey: 'P', verifiedFacts: [{summary: '项目必须使用 UTF-8', verified: true, evidence: ['test:1']}]})
    const route = routeWith(store)

    const listedRes = response()
    await route({req: {method: 'GET'}, res: listedRes, url: new URL('http://localhost/api/projects/P/memory-candidates')})
    assert.equal(listedRes.status, 200)
    const listed = JSON.parse(listedRes.body)
    assert.equal(listed.candidates.length, 1)
    assert.equal(listed.candidates[0].candidateId, candidate.candidateId)
    assert.equal(Object.hasOwn(listed.candidates[0], 'metadata'), false)

    const approveRes = response()
    await route({req: {method: 'PUT', body: {action: 'approve', actor: 'user', sourceEvidence: ['test:1']}}, res: approveRes, url: new URL(`http://localhost/api/projects/P/memory-candidates/${candidate.candidateId}`)})
    assert.equal(approveRes.status, 200)
    assert.equal(JSON.parse(approveRes.body).candidate.status, 'active')

    const emptyRes = response()
    await route({req: {method: 'GET'}, res: emptyRes, url: new URL('http://localhost/api/projects/P/memory-candidates')})
    assert.deepEqual(JSON.parse(emptyRes.body).candidates, [])
})

test('Memory candidate 路由拒绝越权、缺证据和未知操作', async () => {
    const store = createMemoryCandidateStore({memoryRepository: repository()})
    const [candidate] = await store.extractMemoryCandidates({taskId: 'task-2', projectKey: 'P', verifiedFacts: [{summary: '规则', verified: true, evidence: ['test:2']}]})
    const route = routeWith(store, {identity: {source: 'desktop', userId: 'u1'}, owns: false})
    const forbidden = response()
    await route({req: {method: 'GET'}, res: forbidden, url: new URL('http://localhost/api/projects/P/memory-candidates')})
    assert.equal(forbidden.status, 403)

    const ownedRoute = routeWith(store, {identity: {source: 'desktop', userId: 'u1'}, owns: true})
    const missingEvidence = response()
    await ownedRoute({req: {method: 'PUT', body: {action: 'approve', actor: 'u1'}}, res: missingEvidence, url: new URL(`http://localhost/api/projects/P/memory-candidates/${candidate.candidateId}`)})
    assert.equal(missingEvidence.status, 400)
    assert.equal(JSON.parse(missingEvidence.body).code, 'MEMORY_CANDIDATE_APPROVAL_REQUIRED')

    const invalidAction = response()
    await ownedRoute({req: {method: 'PUT', body: {action: 'wait'}}, res: invalidAction, url: new URL(`http://localhost/api/projects/P/memory-candidates/${candidate.candidateId}`)})
    assert.equal(invalidAction.status, 400)
    assert.equal(JSON.parse(invalidAction.body).code, 'MEMORY_CANDIDATE_ACTION_INVALID')
})

test('Memory candidate 存储不可用时返回 503', async () => {
    const route = routeWith(null)
    const res = response()
    await route({req: {method: 'GET'}, res, url: new URL('http://localhost/api/projects/P/memory-candidates')})
    assert.equal(res.status, 503)
    assert.equal(JSON.parse(res.body).code, 'MEMORY_CANDIDATE_STORE_UNAVAILABLE')
})
