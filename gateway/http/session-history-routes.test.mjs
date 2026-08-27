import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createMemoryRoutes} from './memory-routes.mjs'

function response() {
    return {status: 0, headers: {}, writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers) }, end(body) { this.body = body }}
}

const sessionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
function routeWith(resolveResult, {identity = null, owns = true, readError = null} = {}) {
    const filePath = join(mkdtempSync(join(tmpdir(), 'history-route-')), `${sessionId}.jsonl`)
    writeFileSync(filePath, '{}\n')
    return createMemoryRoutes({
        resolveSessionTranscript: () => ({...resolveResult, filePath}),
        getAdapterIdentity: () => identity,
        adapterOwnsProject: () => owns,
        parseSessionHistory: () => { if (readError) throw readError; return [{role: 'user', text: '历史'}] },
        readFileSync: path => path === filePath ? '{}\n' : '',
        log: {warn() {}, error() {}},
    })
}

async function request(route, path) {
    const res = response()
    await route({req: {method: 'GET'}, res, url: new URL(`http://localhost${path}`)})
    return {res, body: res.body ? JSON.parse(res.body) : null}
}

test('ID 主定位历史接口返回 200，旧项目接口共享 handler', async () => {
    const route = routeWith({status: 'found', encodedDir: 'D--legacy', workDir: 'D:/work'})
    const {res, body} = await request(route, `/api/sessions/${sessionId}/messages`)
    assert.equal(res.status, 200)
    assert.equal(body.encodedDir, 'D--legacy')
    assert.equal(body.messages[0].text, '历史')
})

test('历史接口返回 404、409、403、500 明确错误', async t => {
    const cases = [
        [{status: 'missing'}, 404, 'HISTORY_NOT_FOUND'],
        [{status: 'ambiguous', matches: [{encodedDir: 'a', filePath: 'a'}, {encodedDir: 'b', filePath: 'b'}]}, 409, 'HISTORY_LOCATION_AMBIGUOUS'],
        [{status: 'found', encodedDir: 'D--other'}, 403, 'HISTORY_PERMISSION_DENIED', {identity: {source: 'desktop', userId: 'u'}, owns: false}],
        [{status: 'found', encodedDir: 'D--work'}, 500, 'HISTORY_READ_FAILED', {readError: new Error('broken')}],
    ]
    for (const [result, status, code, options] of cases) {
        const {res, body} = await request(routeWith(result, options), `/api/sessions/${sessionId}/messages`)
        assert.equal(res.status, status)
        assert.equal(body.code, code)
    }
})
