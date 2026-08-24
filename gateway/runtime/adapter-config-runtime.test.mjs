import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAdapterConfigRuntime} from './adapter-config-runtime.mjs'

function makeRuntime() {
    const home = mkdtempSync(join(tmpdir(), 'bridge-adapter-runtime-'))
    const configPath = join(home, 'adapters.json')
    const sessionsPath = join(home, 'adapter-sessions.json')
    const keyPath = join(home, 'key')
    const sessions = new Map([['gateway-1', {lastSessionId: 'sdk-1'}]])
    const runtime = createAdapterConfigRuntime({
        bridgeHome: home,
        adapterConfigPath: configPath,
        adapterSessionsPath: sessionsPath,
        securePayloadKeyPath: keyPath,
        adapterPlatforms: ['wechat'],
        readJSON(path) {
            try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
        },
        writeJSON(path, value) { writeFileSync(path, JSON.stringify(value)) },
        existsSync: path => {
            try { readFileSync(path); return true } catch { return false }
        },
        readAdapterConfigImpl: () => ({wechat: {botToken: 'secret'}}),
        writeAdapterConfigImpl: (path, value) => writeFileSync(path, JSON.stringify(value)),
        migrateAdapterConfigImpl: () => ({migrated: false, config: {}}),
        sessions,
        getFocusedSessionId: () => 'gateway-1',
        encodeProjectName: value => encodeURIComponent(value),
    })
    return {runtime, sessionsPath}
}

test('Adapter Runtime 集中管理加密配置和绑定归属', () => {
    const {runtime, sessionsPath} = makeRuntime()
    assert.equal(runtime.loadAdapterConfig().wechat.botToken, 'secret')
    runtime.writeAdapterBindings({
        'wechat:user-1': {platform: 'wechat', userId: 'user-1', sessionId: 'gateway-1', workDir: 'D:/project'},
        'wechat:user-2': {platform: 'wechat', userId: 'user-2', sessionId: 'stale', workDir: 'D:/project'},
    })
    assert.equal(runtime.adapterOwnsFocusedSession({source: 'wechat', userId: 'user-1'}), true)
    assert.equal(runtime.adapterOwnsProject({source: 'wechat', userId: 'user-1'}, encodeURIComponent('D:/project')), true)
    assert.equal(runtime.isAdapterSessionActive('sdk-1'), true)
    assert.equal(runtime.listAdapterBindings().length, 2)
    assert.ok(readFileSync(sessionsPath, 'utf8').includes('user-1'))
    assert.equal(runtime.clearAdapterBindingsForSessions('stale'), 1)
})
