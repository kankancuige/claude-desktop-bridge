import test from 'node:test'
import assert from 'node:assert/strict'
import {detectCommand, executeCommand} from './im-commands.mjs'

function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {'Content-Type': 'application/json'},
    })
}

test('项目查询不依赖活跃桌面 Session', async () => {
    const originalFetch = globalThis.fetch
    const calls = []
    globalThis.fetch = async (url, init = {}) => {
        calls.push({url: String(url), method: init.method || 'GET', body: init.body || ''})
        if (String(url).endsWith('/api/projects')) return jsonResponse(200, {projects: [{workDir: 'D:\\work', sessionCount: 1}]})
        throw new Error(`unexpected request: ${url}`)
    }
    try {
        const result = await executeCommand(detectCommand('/p'), 'token', {source: 'wechat', userId: 'user-1'})
        assert.equal(calls.length, 1)
        assert.match(calls[0].url, /\/api\/projects$/)
        assert.match(result.replyText, /work/)
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('新建会话命令不依赖既有 Session', async () => {
    const originalFetch = globalThis.fetch
    const calls = []
    globalThis.fetch = async (url, init = {}) => {
        calls.push({url: String(url), method: init.method || 'GET', body: init.body || ''})
        if (String(url).endsWith('/api/desktop/nudge')) return jsonResponse(200, {delivered: true})
        throw new Error(`unexpected request: ${url}`)
    }
    try {
        const result = await executeCommand(detectCommand('/ns demo'), 'token', {source: 'wechat', userId: 'user-1'})
        assert.equal(calls.length, 1)
        assert.match(calls[0].url, /\/api\/desktop\/nudge$/)
        assert.deepEqual(JSON.parse(calls[0].body), {
            action: 'new_session',
            args: {projectName: 'demo'},
            source: 'adapter',
        })
        assert.match(result.replyText, /新建会话/)
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('停止命令仍要求活跃桌面 Session', async () => {
    const originalFetch = globalThis.fetch
    const calls = []
    globalThis.fetch = async (url, init = {}) => {
        calls.push({url: String(url), method: init.method || 'GET'})
        return jsonResponse(409, {error: 'no_active_session'})
    }
    try {
        const result = await executeCommand(detectCommand('/stop'), 'token', {source: 'feishu', userId: 'user-2'})
        assert.equal(calls.length, 1)
        assert.match(calls[0].url, /\/api\/sessions\/resolve$/)
        assert.match(result.replyText, /Session/)
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('帮助命令不依赖桌面 Session 绑定', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => { throw new Error('help must not access gateway') }
    try {
        const result = await executeCommand(detectCommand('/h'), 'token', {source: 'dingtalk', userId: 'user-3'})
        assert.match(result.replyText, /\/p/)
    } finally {
        globalThis.fetch = originalFetch
    }
})
