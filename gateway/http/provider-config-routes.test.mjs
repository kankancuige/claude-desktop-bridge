import assert from 'node:assert/strict'
import test from 'node:test'
import {createProviderConfigRoutes} from './provider-config-routes.mjs'

function response() { return {statusCode: 0, writeHead(status) { this.statusCode = status }, end(body) { this.body = body }} }

function route(overrides = {}) {
    return createProviderConfigRoutes({
        dynamicCache: {models: [{value: 'm1'}], updatedAt: 1},
        getLiveQuery: () => null,
        withTimeout: promise => promise,
        persistDynamicCache: () => {},
        loadCliSettings: () => ({}),
        fetchProviderResponse: async () => ({response: {ok: false, status: 404, text: async () => ''}, url: ''}),
        validateProviderUrl: async value => new URL(value),
        buildProviderModelsUrl: value => value,
        buildProviderFallbackUrls: () => [],
        providers: [],
        readBody: async req => req.body || {},
        log: {debug() {}, warn() {}, error() {}},
        restoreSecretValue: value => value,
        ...overrides,
    })
}

test('Provider 配置路由返回缓存模型并拒绝空供应商参数', async () => {
    const handler = route()
    const models = response()
    assert.equal(await handler({req: {method: 'GET'}, res: models, url: new URL('http://127.0.0.1/api/config/models')}), true)
    assert.deepEqual(JSON.parse(models.body).models, [{value: 'm1'}])
    const live = response()
    assert.equal(await handler({req: {method: 'POST', body: {}}, res: live, url: new URL('http://127.0.0.1/api/config/live-models')}), true)
    assert.equal(live.statusCode, 200)
    assert.equal(JSON.parse(live.body).error, 'no_creds')
})

test('Provider 配置路由将未知路径交回组合根', async () => {
    const res = response()
    assert.equal(await route()({req: {method: 'GET'}, res, url: new URL('http://127.0.0.1/api/unknown')}), false)
})

test('Provider 配置路由返回供应商预设', async () => {
    const handler = route({providers: [{id: 'p1'}]})
    const res = response()
    assert.equal(await handler({req: {method: 'GET'}, res, url: new URL('http://127.0.0.1/api/config/providers')}), true)
    assert.deepEqual(JSON.parse(res.body), {providers: [{id: 'p1'}]})
})
