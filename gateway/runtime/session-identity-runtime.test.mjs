import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionIdentityRuntime} from './session-identity-runtime.mjs'

test('Session Identity Runtime 管理映射更新和可见性保存', () => {
    const files = new Map()
    const visibility = new Map()
    const runtime = createSessionIdentityRuntime({
        bridgeHome: 'D:/bridge',
        encodeProjectName: value => value,
        readJSON: path => files.get(path) || visibility.get(path) || null,
        writeJSON: (path, value) => files.set(path, value),
        readdirSync: () => [], statSync: () => ({isDirectory: () => true}),
        loadSessionVisibility: path => visibility.get(path) || {version: 1, sessions: {}},
        ensureSessionCatalogIdentity: () => {}, invalidateProjectsCache: () => {},
    })
    assert.equal(runtime.persistSdkSessionId('p', 'g', 's'), true)
    assert.equal(runtime.lookupSdkSessionId('p', 'g'), 's')
    assert.equal(runtime.lookupGatewaySessionId('p', 's'), 'g')
    assert.equal(runtime.markVisibleSession('p', 'g', 's', 'desktop'), true)
    assert.equal(runtime.removeVisibleSession('p', 'g', 's'), true)
    assert.equal(runtime.removeSdkSessionId('p', 'g', 's'), true)
})
