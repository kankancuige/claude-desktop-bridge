import test from 'node:test'
import assert from 'node:assert/strict'
import {createHttpRequestHandler} from './request-handler.mjs'

function response() {
    return {
        headers: {},
        statusCode: 200,
        headersSent: false,
        setHeader(name, value) { this.headers[name] = value },
        writeHead(status) { this.statusCode = status; this.headersSent = true },
        end(body) { this.body = body; this.headersSent = true },
    }
}

function request({method = 'GET', url = '/', token = 'ok', source, userId} = {}) {
    return {method, url, headers: {'x-bridge-token': token, ...(source ? {'x-bridge-source': source} : {}), ...(userId ? {'x-bridge-user-id': userId} : {})}}
}

test('HTTP handler applies authentication before route dispatch', async () => {
    let dispatched = 0
    const handler = createHttpRequestHandler({
        port: 3456,
        bridgeToken: 'secret',
        authenticateBridgeToken: token => token === 'ok' ? {kind: 'desktop'} : null,
        routes: [async () => { dispatched++; return true }],
    })
    const forbidden = response()
    await handler(request({token: 'bad'}), forbidden)
    assert.equal(forbidden.statusCode, 403)
    assert.equal(dispatched, 0)
    const accepted = response()
    await handler(request(), accepted)
    assert.equal(dispatched, 1)
})

test('HTTP handler enforces adapter route and ownership boundaries', async () => {
    const handler = createHttpRequestHandler({
        port: 3456,
        authenticateBridgeToken: () => ({kind: 'adapter', platform: 'wechat'}),
        getAdapterIdentity: req => ({source: req.headers['x-bridge-source'], userId: req.headers['x-bridge-user-id']}),
        adapterRouteAllowed: (method, pathname) => method === 'GET' && pathname === '/api/projects',
        adapterOwnsSession: () => false,
        routes: [async ({res}) => { res.writeHead(200); res.end('{}'); return true }],
    })
    const denied = response()
    await handler(request({url: '/api/sessions/owned', method: 'GET', source: 'wechat', userId: 'u1'}), denied)
    assert.equal(denied.statusCode, 403)
    const accepted = response()
    await handler(request({url: '/api/projects', source: 'wechat', userId: 'u1'}), accepted)
    assert.equal(accepted.statusCode, 200)
})

test('HTTP handler returns CORS preflight and a stable 404', async () => {
    const handler = createHttpRequestHandler({
        port: 3456,
        authenticateBridgeToken: () => ({kind: 'desktop'}),
        routes: [],
    })
    const options = response()
    await handler(request({method: 'OPTIONS', token: ''}), options)
    assert.equal(options.statusCode, 204)
    const missing = response()
    await handler(request({url: '/missing'}), missing)
    assert.equal(missing.statusCode, 404)
    assert.deepEqual(JSON.parse(missing.body), {error: 'not found'})
})
