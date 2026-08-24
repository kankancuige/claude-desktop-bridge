import test from 'node:test'
import assert from 'node:assert/strict'
import {createPreferencesRoutes} from './preferences-routes.mjs'

function response() {
    return {
        statusCode: 0,
        headers: {},
        setHeader(name, value) { this.headers[name] = value },
        writeHead(status, headers = {}) { this.statusCode = status; Object.assign(this.headers, headers) },
        end(value) { this.body = value },
    }
}

function request(method, path) {
    return {method, headers: {}, url: path}
}

test('偏好路由保持列表、建议响应和项目更新契约', async () => {
    const calls = []
    const service = {
        listAll: () => ({global: [{id: 'a'}]}),
        respond: input => { calls.push(['respond', input]); return {ok: true} },
        update: input => { calls.push(['update', input]); return {id: input.id, enabled: input.enabled} },
        remove: input => { calls.push(['remove', input]); return {id: input.id} },
    }
    const route = createPreferencesRoutes({
        getService: () => service,
        decode: decodeURIComponent,
        basename: value => value.split(/[\\/]/).pop(),
        isDirectoryPath: value => value === 'D:/project',
        readBody: async req => req.body || {},
    })
    const listRes = response()
    assert.equal(await route({req: request('GET', '/api/preferences'), res: listRes, url: new URL('http://127.0.0.1/api/preferences')}), true)
    assert.deepEqual(JSON.parse(listRes.body), {global: [{id: 'a'}]})
    const suggestionRes = response()
    const suggestionReq = request('POST', '/api/preferences/suggestions/s-1/respond')
    suggestionReq.body = {projectDir: 'D:/project', action: 'accept'}
    await route({req: suggestionReq, res: suggestionRes, url: new URL('http://127.0.0.1/api/preferences/suggestions/s-1/respond')})
    const updateRes = response()
    const updateReq = request('PUT', '/api/preferences/project/p-1')
    updateReq.body = {encodedDir: 'project-x', enabled: false}
    await route({req: updateReq, res: updateRes, url: new URL('http://127.0.0.1/api/preferences/project/p-1')})
    assert.deepEqual(calls, [
        ['respond', {projectDir: 'D:/project', suggestionId: 's-1', action: 'accept'}],
        ['update', {scope: 'project', id: 'p-1', enabled: false, encodedDir: 'project-x'}],
    ])
})
test('项目偏好缺少安全 encodedDir 时拒绝修改', async () => {
    const route = createPreferencesRoutes({getService: () => ({update() { throw new Error('must not call') }}), readBody: async () => ({})})
    const res = response()
    const req = request('PUT', '/api/preferences/project/p-1')
    await route({req, res, url: new URL('http://127.0.0.1/api/preferences/project/p-1')})
    assert.equal(res.statusCode, 400)
    assert.equal(JSON.parse(res.body).error, 'project preference requires encodedDir')
})
