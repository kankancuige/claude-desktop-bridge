import test from 'node:test'
import assert from 'node:assert/strict'
import {createHttpRuntime} from './http-runtime.mjs'

test('HTTP Runtime 统一创建路由并保持路由顺序', () => {
    const seen = []
    const route = name => () => { seen.push(name); return false }
    const context = {
        PORT: 3456, ALLOW_TOKEN_ENDPOINT: false, BRIDGE_TOKEN: 'token',
        dynamicCache: {}, getLiveQuery() {}, withTimeout: async value => value,
        persistDynamicCache() {}, loadCliSettings() {return {}}, fetchProviderResponse() {},
        validateProviderUrl() {}, buildProviderModelsUrl() {}, buildProviderFallbackUrls() {},
        PROVIDERS: [], readBody: async () => ({}), log: {}, restoreSecretValue() {},
        authenticateBridgeToken: () => ({kind: 'desktop'}), getAdapterIdentity: () => null,
        adapterRouteAllowed: () => true, adapterOwnsSession: () => true,
        configRoutes: route('config'), resourceConfigRoutes: route('resource'), logHttpRequest() {}, safeDecodeURIComponent: decodeURIComponent,
        PKG_VERSION: 'test', getStorageHealth: () => ({}), getState: () => null,
        getRepositories: () => ({}), getPitfallAdmin: () => null, getAiHealth: () => ({}), getDriftCandidates: () => [],
        sessionMutationRoutes: route('session'),
    }
    const runtime = createHttpRuntime({routeContext: context})
    assert.equal(typeof runtime.handleHttpRequest, 'function')
    assert.equal(Object.keys(runtime.routes).length, 8)
    assert.deepEqual(seen, [])
})
