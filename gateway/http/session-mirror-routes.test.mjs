import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionFileRoutes} from './session-file-routes.mjs'

function response() {
    const state = {status: null, body: ''}
    return {
        state,
        setHeader() {},
        writeHead(status) { state.status = status },
        end(body = '') { state.body = String(body) },
    }
}

test('Session 镜像开关通过组合根注入的持久化端口保存', async () => {
    const sessions = new Map([['session-1', {
        mirrors: {wechat: false, feishu: false, dingtalk: false},
        clients: new Set(),
    }]])
    const calls = []
    const route = createSessionFileRoutes({
        sessions,
        ADAPTER_PLATFORMS: ['wechat', 'feishu', 'dingtalk'],
        getAdapterIdentity: () => null,
        adapterOwnsSession: () => true,
        readBody: async () => ({platform: 'wechat', enabled: true}),
        persistSessionMirrors: (...args) => { calls.push(args); return true },
        controlClients: new Set(),
    })
    const res = response()

    await route({
        req: {method: 'POST', headers: {}},
        res,
        url: {pathname: '/api/sessions/session-1/mirror'},
    })

    assert.equal(res.state.status, 200)
    assert.deepEqual(JSON.parse(res.state.body), {ok: true, platform: 'wechat', enabled: true})
    assert.deepEqual(calls, [[sessions.get('session-1'), 'session-1', 'wechat', true]])
})
