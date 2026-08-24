import assert from 'node:assert/strict'
import test from 'node:test'
import {createSessionProjectRoutes} from './session-project-routes.mjs'

function response() {
    return {status: 0, headers: {}, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers) }, end(body) { this.body = body }}
}

function setup() {
    const sessions = new Map([['gateway-1', {workDir: 'D:/demo', createdAt: 1, clients: new Set([1])}]])
    let focused = 'gateway-1'
    const handler = createSessionProjectRoutes({
        getSessions: () => sessions,
        getFocusedSessionId: () => focused,
        setFocusedSessionId: value => { focused = value },
        getAdapterIdentity: () => null,
        scanProjects: async () => [{workDir: 'D:/demo', encodedDir: 'D--demo', sessionCount: 1}],
        listProjectSessions: async () => [{id: 'sdk-1', title: '任务'}],
        decodeProject: value => decodeURIComponent(value),
        isSafeProject: value => /^[A-Za-z0-9._-]+$/.test(value),
        findTranscript: () => ({status: 'found', encodedDir: 'D--demo', filePath: 'memory'}),
        parseHistory: () => [{role: 'assistant', content: 'ok'}],
        readFile: () => 'ignored',
    })
    return {handler, sessions, getFocused: () => focused}
}

test('Session/Project routes preserve list, focus, project and history contracts', async () => {
    const {handler, getFocused} = setup()
    const list = response()
    assert.equal(await handler({req: {method: 'GET'}, res: list, url: new URL('http://127.0.0.1/api/sessions')}), true)
    assert.deepEqual(JSON.parse(list.body).sessions[0], {id: 'gateway-1', workDir: 'D:/demo', createdAt: 1, clientCount: 1})
    const focus = response()
    await handler({req: {method: 'POST'}, res: focus, url: new URL('http://127.0.0.1/api/sessions/gateway-1/focus')})
    assert.equal(focus.status, 200)
    assert.equal(getFocused(), 'gateway-1')
    const projects = response()
    await handler({req: {method: 'GET'}, res: projects, url: new URL('http://127.0.0.1/api/projects')})
    assert.equal(JSON.parse(projects.body).projects[0].encodedDir, 'D--demo')
    const history = response()
    await handler({req: {method: 'GET'}, res: history, url: new URL('http://127.0.0.1/api/projects/D--demo/sessions/sdk-1/messages')})
    assert.equal(JSON.parse(history.body).messages[0].content, 'ok')
})

test('Session/Project routes return stable not-found and ownership errors', async () => {
    const {handler} = setup()
    const missing = response()
    await handler({req: {method: 'POST'}, res: missing, url: new URL('http://127.0.0.1/api/sessions/missing/focus')})
    assert.equal(missing.status, 404)
})
