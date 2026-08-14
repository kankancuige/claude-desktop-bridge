import test from 'node:test'
import assert from 'node:assert/strict'
import {detectCommand, executeCommand} from './im-commands.mjs'

function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {'Content-Type': 'application/json'},
    })
}

test('IM 控制命令先绑定当前桌面 Session 再访问受保护接口', async () => {
    const originalFetch = globalThis.fetch
    const calls = []
    globalThis.fetch = async (url, init = {}) => {
        calls.push({url: String(url), method: init.method || 'GET', body: init.body || ''})
        if (String(url).endsWith('/api/sessions/resolve')) return jsonResponse(200, {sessionId: 'session-1'})
        if (String(url).endsWith('/api/projects')) return jsonResponse(200, {projects: [{workDir: 'D:\\work', sessionCount: 1}]})
        throw new Error(`unexpected request: ${url}`)
    }
    try {
        const result = await executeCommand(detectCommand('/p'), 'token', {source: 'wechat', userId: 'user-1'})
        assert.equal(calls.length, 2)
        assert.match(calls[0].url, /\/api\/sessions\/resolve$/)
        assert.equal(calls[0].method, 'POST')
        assert.equal(JSON.parse(calls[0].body).userId, 'user-1')
        assert.match(calls[1].url, /\/api\/projects$/)
        assert.match(result.replyText, /work/)
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('没有活跃桌面 Session 时命令明确收口且不继续访问目标接口', async () => {
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = async () => {
        calls++
        return jsonResponse(409, {error: 'no_active_session'})
    }
    try {
        const result = await executeCommand(detectCommand('/stop'), 'token', {source: 'feishu', userId: 'user-2'})
        assert.equal(calls, 1)
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
