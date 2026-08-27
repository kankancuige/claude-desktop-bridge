import assert from 'node:assert/strict'
import test from 'node:test'
import {listAdapterBindings} from '../im/adapter-bindings.mjs'
import {createAdapterConfigRoutes} from './adapter-config-routes.mjs'
import {createMemoryRoutes} from './memory-routes.mjs'
import {createSessionMutationRoutes} from './session-mutation-routes.mjs'

function response() {
    return {
        status: 0,
        headers: {},
        writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers) },
        end(body) { this.body = body },
    }
}

const identity = {source: 'wechat', userId: 'user-1'}

test('适配器状态区分已配对用户与历史 Session 路由', async () => {
    const wechatHook = {
        connectionStatus: () => ({state: 'running'}),
        pairedUserCount: () => 1,
        pairingCode: () => 'pair-code',
    }
    const route = createAdapterConfigRoutes({
        ADAPTER_PLATFORMS: ['wechat', 'feishu', 'dingtalk'],
        adapterConfigReadError: '',
        confirmHooks: [],
        getAdapterHook: platform => platform === 'wechat' ? wechatHook : null,
        isAdapterSessionActive: () => false,
        listAdapterBindings,
        loadAdapterConfig: () => ({wechat: {botToken: 'configured'}}),
        normalizeWeChatBaseUrl: value => value || 'https://ilinkai.weixin.qq.com',
        readAdapterBindings: () => ({
            'wechat:user-1': {platform: 'wechat', userId: 'user-1', sessionId: 'old-session', updatedAt: 1},
        }),
    })
    const res = response()

    await route({req: {method: 'GET'}, res, url: new URL('http://localhost/api/config/adapters')})

    assert.equal(res.status, 200)
    const wechat = JSON.parse(res.body).platforms.find(platform => platform.id === 'wechat')
    assert.equal(wechat.pairedUserCount, 1)
    assert.deepEqual(wechat.bindings, {
        total: 1,
        active: 0,
        stale: 1,
        users: ['us••-1'],
        paired: 1,
    })
})

test('Adapter 未运行时仍从持久化白名单报告已配对用户', async () => {
    const route = createAdapterConfigRoutes({
        ADAPTER_PLATFORMS: ['wechat', 'feishu', 'dingtalk'],
        adapterConfigReadError: '',
        confirmHooks: [],
        getAdapterHook: () => null,
        getPersistedPairedUserCount: platform => platform === 'wechat' ? 1 : 0,
        isAdapterSessionActive: () => false,
        listAdapterBindings,
        loadAdapterConfig: () => ({wechat: {botToken: 'configured'}}),
        normalizeWeChatBaseUrl: value => value || 'https://ilinkai.weixin.qq.com',
        readAdapterBindings: () => ({}),
    })
    const res = response()

    await route({req: {method: 'GET'}, res, url: new URL('http://localhost/api/config/adapters')})

    assert.equal(res.status, 200)
    const wechat = JSON.parse(res.body).platforms.find(platform => platform.id === 'wechat')
    assert.equal(wechat.status, 'configured')
    assert.equal(wechat.pairedUserCount, 1)
    assert.equal(wechat.bindings.total, 0)
})

test('已认证 IM adapter 无 Session 时可列出项目摘要', async () => {
    const route = createMemoryRoutes({
        getAdapterIdentity: () => identity,
        readAdapterBindings: () => ({}),
        scanProjects: async () => [
            {workDir: 'D:/alpha', encodedDir: 'D--alpha', sessionCount: 2},
            {workDir: 'D:/beta', encodedDir: 'D--beta', sessionCount: 1},
        ],
    })
    const res = response()

    await route({req: {method: 'GET'}, res, url: new URL('http://localhost/api/projects')})

    assert.equal(res.status, 200)
    assert.deepEqual(JSON.parse(res.body).projects.map(project => project.encodedDir), ['D--alpha', 'D--beta'])
})

test('已认证 IM adapter 无 Session 时可列出指定项目的会话摘要', async () => {
    const route = createAdapterConfigRoutes({
        getAdapterIdentity: () => identity,
        readAdapterBindings: () => ({}),
        readBody: async req => req.body,
        scanProjects: async () => [{workDir: 'D:/alpha', encodedDir: 'D--alpha'}],
        listProjectSessions: async () => [
            {id: 'session-1', title: '第一个会话', messages: ['不得返回']},
            {id: 'session-2', title: '第二个会话', workDir: '不得返回'},
        ],
        sessions: new Map(),
        getFocusedSessionId: () => null,
    })
    const res = response()

    await route({
        req: {method: 'POST', body: {label: 'alpha'}},
        res,
        url: new URL('http://localhost/api/sessions-by-label'),
    })

    assert.equal(res.status, 200)
    assert.deepEqual(JSON.parse(res.body).sessions, [
        {id: 'session-1', title: '第一个会话'},
        {id: 'session-2', title: '第二个会话'},
    ])
})

test('无 Session 时导航 nudge 可投递但 stop 仍受所有权保护', async () => {
    const sent = []
    const controlClients = new Set([{readyState: 1, send(payload) { sent.push(JSON.parse(payload)) }}])
    const route = createSessionMutationRoutes({
        NUDGE_ACTIONS: new Set(['new_session', 'stop']),
        adapterOwnsFocusedSession: () => false,
        controlClients,
        crypto: {randomUUID: () => 'nudge-1'},
        getAdapterIdentity: () => identity,
        getFocusedSessionId: () => null,
        readBody: async req => req.body,
        sessions: new Map(),
    })

    const navigation = response()
    await route({
        req: {method: 'POST', body: {action: 'new_session', args: {projectName: 'alpha'}, source: 'adapter'}},
        res: navigation,
        url: new URL('http://localhost/api/desktop/nudge'),
    })
    assert.equal(navigation.status, 200)
    assert.equal(JSON.parse(navigation.body).delivered, true)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].action, 'new_session')

    const stop = response()
    await route({
        req: {method: 'POST', body: {action: 'stop', args: {}, source: 'adapter'}},
        res: stop,
        url: new URL('http://localhost/api/desktop/nudge'),
    })
    assert.equal(stop.status, 403)
    assert.equal(sent.length, 1)
})
