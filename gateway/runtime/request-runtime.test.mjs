import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequestRuntime} from './request-runtime.mjs'

test('request runtime normalizes project paths and adapter identity', () => {
    const runtime = createRequestRuntime({imSources: new Set(['wechat'])})
    assert.equal(runtime.normalizeWorkDir('D:\\a\\b\\'), 'D:/a/b')
    assert.equal(runtime.encodeProjectName('D:/a/b'), 'D--a-b')
    assert.equal(runtime.decodeProjectName('D--a-b'), 'D:/a/b')
    assert.deepEqual(runtime.getAdapterIdentity({headers: {'x-bridge-source': 'wechat', 'x-bridge-user-id': 'u'}}), {source: 'wechat', userId: 'u'})
})

test('request runtime filters unsafe MCP fields', () => {
    const runtime = createRequestRuntime()
    const value = runtime.sanitizeMcpServers({ok: {type: 'stdio', command: 'node', args: ['x'], env: {A: '1', NODE_OPTIONS: 'x'}}, bad: {url: 'file:///x'}})
    assert.deepEqual(value.ok.env, {A: '1'})
    assert.equal(value.bad, undefined)
})
