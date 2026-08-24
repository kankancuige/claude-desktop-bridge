import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createResourceConfigRoutes} from './resource-config-routes.mjs'

function response() {
    return {statusCode: 0, headers: {}, writeHead(status) { this.statusCode = status }, end(body) { this.body = body }}
}

function deps(bridgeHome) {
    return {
        bridgeHome,
        parseFrontmatter: value => ({frontmatter: {}, body: value}),
        builtinCache: {skills: [], agents: [], commands: []},
        safeDecodeURIComponent: decodeURIComponent,
        backupFile: () => {},
        loadCliSettingsForUpdate: () => ({}),
        readJSON: () => ({}),
        log: {debug() {}, info() {}, warn() {}, error() {}},
        readBody: async req => req.body || {},
        dynamicCache: {models: null, commands: null, agentNames: null, updatedAt: 0},
        readFetchBodyLimited: async () => Buffer.from(''),
        maxRemoteTextBytes: 1024,
        cavemanValidLevels: ['lite', 'full', 'ultra', 'wenyan'],
        loadCavemanConfig: () => ({enabled: false, level: 'full'}),
        saveCavemanConfig: () => {},
        downloadAndReplaceCaveman: async () => {},
        loadRtkConfig: () => ({enabled: true}),
        locateRtk: () => null,
        saveRtkConfig: () => {},
        downloadAndReplaceRtk: async () => {},
        builtinAgentTypes: {},
        loadWfConfig: () => ({enabled: true}),
        saveWfConfig: () => {},
    }
}

test('资源路由列出并创建 Skill，未知路径交回组合根', async () => {
    const home = mkdtempSync(join(tmpdir(), 'bridge-resource-routes-'))
    try {
        const handler = createResourceConfigRoutes(deps(home))
        const list = response()
        assert.equal(await handler({req: {method: 'GET'}, res: list, url: new URL('http://127.0.0.1/api/config/skills')}), true)
        assert.deepEqual(JSON.parse(list.body), {skills: []})
        const created = response()
        assert.equal(await handler({req: {method: 'POST', body: {name: 'My Skill'}}, res: created, url: new URL('http://127.0.0.1/api/config/skills')}), true)
        assert.equal(created.statusCode, 201)
        assert.equal(JSON.parse(created.body).name, 'my-skill')
        const unknown = response()
        assert.equal(await handler({req: {method: 'GET'}, res: unknown, url: new URL('http://127.0.0.1/api/other')}), false)
    } finally {
        rmSync(home, {recursive: true, force: true})
    }
})

test('资源路由拒绝越界 Skill 名称', async () => {
    const home = mkdtempSync(join(tmpdir(), 'bridge-resource-routes-'))
    try {
        const handler = createResourceConfigRoutes(deps(home))
        const res = response()
        assert.equal(await handler({req: {method: 'GET'}, res, url: new URL('http://127.0.0.1/api/config/skills/..%2Fsecret')}), true)
        assert.equal(res.statusCode, 400)
    } finally {
        rmSync(home, {recursive: true, force: true})
    }
})
