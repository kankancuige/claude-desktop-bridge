import test from 'node:test'
import assert from 'node:assert/strict'
import {createConfigRoutes} from './config-routes.mjs'

function response() {
    return {
        statusCode: 200,
        body: null,
        writeHead(status) { this.statusCode = status },
        end(body) { this.body = body },
    }
}

function createFixture() {
    const files = new Map([['D:/bridge/settings.json', {theme: 'dark', env: {ANTHROPIC_AUTH_TOKEN: '[REDACTED]'}}]])
    const provider = {model: 'gpt-5.6-sol', env: {ANTHROPIC_BASE_URL: 'https://provider.test', ANTHROPIC_AUTH_TOKEN: 'secret'}}
    return {
        route: createConfigRoutes({
            bridgeHome: 'D:/bridge',
            version: '1.5.0',
            readJSON: path => files.get(path) || null,
            writeJSON: (path, value) => files.set(path, value),
            backupFile: () => {},
            loadBridgeProviderSettings: () => provider,
            saveBridgeProviderSettings: value => { provider.model = value.model; provider.env = value.env },
            overlayBridgeProviderSettings: (settings, current) => ({...settings, model: current.model, env: {...settings.env, ...current.env}}),
            extractBridgeProviderSettings: value => ({model: value.model, env: value.env}),
            stripBridgeProviderSettings: value => value,
            redactSecretMap: value => ({...value, ANTHROPIC_AUTH_TOKEN: '[REDACTED]'}),
            restoreSecretMap: value => value,
            getClaudeExe: () => 'D:/claude.exe',
            loadCliSettingsForUpdate: () => ({}),
            setClaudeExe: () => {},
            existsSync: path => path === 'D:/claude.exe',
            readBody: async () => ({}),
        }),
        files,
    }
}

test('config routes expose saved settings and version after HTTP composition', async () => {
    const {route} = createFixture()
    const settings = response()
    assert.equal(await route({req: {method: 'GET'}, res: settings, url: new URL('http://127.0.0.1/api/config/settings')}), true)
    assert.equal(settings.statusCode, 200)
    assert.equal(JSON.parse(settings.body).model, 'gpt-5.6-sol')
    assert.equal(JSON.parse(settings.body).env.ANTHROPIC_AUTH_TOKEN, '[REDACTED]')

    const version = response()
    assert.equal(await route({req: {method: 'GET'}, res: version, url: new URL('http://127.0.0.1/api/version')}), true)
    assert.deepEqual(JSON.parse(version.body), {version: '1.5.0'})
})

test('config routes report Claude executable status', async () => {
    const {route} = createFixture()
    const res = response()
    assert.equal(await route({req: {method: 'GET'}, res, url: new URL('http://127.0.0.1/api/config/claude-status')}), true)
    assert.deepEqual(JSON.parse(res.body), {found: true, path: 'D:/claude.exe'})
})
