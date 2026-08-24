import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createProviderRuntime} from './provider-runtime.mjs'

function makeRuntime() {
    const home = mkdtempSync(join(tmpdir(), 'bridge-provider-runtime-'))
    const providerPath = join(home, 'bridge-provider.json')
    const settingsPath = join(home, 'settings.json')
    const logs = []
    const proxyCalls = []
    const runtime = createProviderRuntime({
        bridgeHome: home,
        model: 'fallback-model',
        providerSettingsPath: providerPath,
        settingsPath,
        env: {ANTHROPIC_BASE_URL: 'https://env.example/anthropic', ANTHROPIC_API_KEY: 'env-key'},
        logger: {debug() {}, warn() {}, error(error) { logs.push(error) }, info() {}},
        proxy: {
            async startDeepSeekProxy() { proxyCalls.push('deepseek') },
            getProxyUrl: () => 'http://127.0.0.1:1/anthropic',
            stopDeepSeekProxy: async () => {},
            isProxyConfiguredFor: () => false,
            async startOpenCodeProxy() { proxyCalls.push('opencode') },
            getOpenCodeProxyUrl: () => 'http://127.0.0.1:2/anthropic',
            stopOpenCodeProxy: async () => {},
            isOpenCodeProxyRunning: () => false,
            getCodexRelayProxyUrl: () => 'http://127.0.0.1:3/anthropic',
            async startCodexRelayProxy() { proxyCalls.push('codex'); return {token: 'relay-token'} },
            stopCodexRelayProxy: async () => {},
        },
    })
    return {runtime, home, providerPath, settingsPath, logs, proxyCalls}
}

test('provider runtime owns isolated provider settings and overlays CLI settings', () => {
    const {runtime, providerPath, settingsPath} = makeRuntime()
    assert.equal(runtime.loadBridgeProviderSettings().env.ANTHROPIC_AUTH_TOKEN, 'env-key')
    writeFileSync(settingsPath, JSON.stringify({hooks: {UserPromptSubmit: []}, env: {CUSTOM: 'value'}}))
    assert.equal(runtime.loadCliSettings().hooks.UserPromptSubmit.length, 0)

    const saved = runtime.saveBridgeProviderSettings({model: 'saved-model', env: {ANTHROPIC_BASE_URL: 'https://saved.example'}})
    assert.equal(saved.model, 'saved-model')
    assert.equal(JSON.parse(readFileSync(providerPath, 'utf8')).model, 'saved-model')
    assert.deepEqual(runtime.loadCliSettingsForUpdate(), {hooks: {UserPromptSubmit: []}, env: {CUSTOM: 'value'}})
})

test('provider runtime keeps proxy decisions behind the provider boundary', async () => {
    const {runtime, proxyCalls} = makeRuntime()
    const direct = await runtime.prepareQueryProvider({baseUrl: 'https://custom.example/anthropic', apiKey: 'key', model: 'm'})
    assert.deepEqual(direct, {
        effectiveBaseUrl: 'https://custom.example/anthropic',
        sdkApiKey: 'key',
        usesDeepSeek: false,
        usesCodexRelay: false,
    })
    assert.deepEqual(proxyCalls, [])
})
