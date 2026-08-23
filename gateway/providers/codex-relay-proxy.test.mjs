import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {startCodexRelayProxy, stopCodexRelayProxy, getCodexRelayProxyToken, getCodexRelayProxyUrl} from './codex-relay-proxy.mjs'

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            server.removeListener('error', reject)
            resolve(server.address().port)
        })
    })
}

function close(server) {
    return new Promise(resolve => server.close(() => resolve()))
}

async function reservePort() {
    const server = createServer()
    const port = await listen(server)
    await close(server)
    return port
}

test('Codex relay proxy converts JSON/SSE and keeps upstream credentials private', async () => {
    const oldAllowLocal = process.env.BRIDGE_ALLOW_LOCAL_PROVIDER
    process.env.BRIDGE_ALLOW_LOCAL_PROVIDER = '1'
    let received = []
    const upstream = createServer(async (req, res) => {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        received.push({url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8'))})
        if (received.length === 1) {
            res.writeHead(200, {'content-type': 'application/json'})
            res.end(JSON.stringify({id: 'resp-json', model: 'gpt-5.6-sol', status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: 'json ok'}]}], usage: {input_tokens: 2, output_tokens: 3}}))
            return
        }
        res.writeHead(200, {'content-type': 'text/event-stream'})
        res.end([
            'event: response.created\ndata: {"response":{"id":"resp-sse","model":"gpt-5.6-sol"}}\n\n',
            'event: response.output_text.delta\ndata: {"output_index":0,"content_index":0,"delta":"stream ok"}\n\n',
            'event: response.completed\ndata: {"response":{"model":"gpt-5.6-sol","usage":{"output_tokens":1}}}\n\n',
        ].join(''))
    })
    const upstreamPort = await listen(upstream)
    const proxyPort = await reservePort()
    try {
        await startCodexRelayProxy({
            upstream: `http://127.0.0.1:${upstreamPort}/api/codex/backend-api/codex`,
            apiKey: 'relay-secret',
            model: 'gpt-5.6-sol',
            port: proxyPort,
        })
        const base = getCodexRelayProxyUrl()
        const localToken = getCodexRelayProxyToken()
        assert.equal((await fetch(`${base}/v1/messages`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({model: 'claude-opus-4', messages: [{role: 'user', content: 'hello'}]})})).status, 401)
        const jsonResponse = await fetch(`${base}/v1/messages`, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${localToken}`}, body: JSON.stringify({model: 'claude-opus-4', messages: [{role: 'user', content: 'hello'}]})})
        assert.equal(jsonResponse.status, 200)
        assert.equal((await jsonResponse.json()).content[0].text, 'json ok')
        const streamResponse = await fetch(`${base}/v1/messages`, {method: 'POST', headers: {'content-type': 'application/json', 'x-api-key': localToken}, body: JSON.stringify({model: 'claude-opus-4', stream: true, messages: [{role: 'user', content: 'hello'}]})})
        const streamText = await streamResponse.text()
        assert.match(streamText, /text_delta/)
        assert.match(streamText, /message_stop/)
        assert.equal(received[0].url, '/api/codex/backend-api/codex/responses')
        assert.equal(received[0].auth, 'Bearer relay-secret')
        assert.equal(received[0].body.model, 'gpt-5.6-sol')
        assert.equal(received[0].body.input[0].content[0].text, 'hello')
    } finally {
        await stopCodexRelayProxy()
        await close(upstream)
        if (oldAllowLocal === undefined) delete process.env.BRIDGE_ALLOW_LOCAL_PROVIDER
        else process.env.BRIDGE_ALLOW_LOCAL_PROVIDER = oldAllowLocal
    }
})

test('Codex relay keeps existing sessions isolated when another session changes model', async () => {
    const oldAllowLocal = process.env.BRIDGE_ALLOW_LOCAL_PROVIDER
    process.env.BRIDGE_ALLOW_LOCAL_PROVIDER = '1'
    const receivedModels = []
    const upstream = createServer(async (req, res) => {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        receivedModels.push(body.model)
        res.writeHead(200, {'content-type': 'application/json'})
        res.end(JSON.stringify({
            id: `resp-${receivedModels.length}`,
            model: body.model,
            status: 'completed',
            output: [{type: 'message', content: [{type: 'output_text', text: body.model}]}],
            usage: {input_tokens: 1, output_tokens: 1},
        }))
    })
    const upstreamPort = await listen(upstream)
    const proxyPort = await reservePort()
    try {
        const common = {
            upstream: `http://127.0.0.1:${upstreamPort}/api/codex/backend-api/codex`,
            apiKey: 'shared-relay-secret',
            port: proxyPort,
        }
        await startCodexRelayProxy({...common, model: 'gpt-5.6-sol'})
        const solToken = getCodexRelayProxyToken()
        await startCodexRelayProxy({...common, model: 'gpt-5.6-terra'})
        const terraToken = getCodexRelayProxyToken()

        assert.notEqual(solToken, terraToken)
        const base = getCodexRelayProxyUrl()
        const solResponse = await fetch(`${base}/v1/messages`, {
            method: 'POST',
            headers: {'content-type': 'application/json', authorization: `Bearer ${solToken}`},
            body: JSON.stringify({model: 'claude-opus-4', messages: [{role: 'user', content: 'sol'}]}),
        })
        const terraResponse = await fetch(`${base}/v1/messages`, {
            method: 'POST',
            headers: {'content-type': 'application/json', authorization: `Bearer ${terraToken}`},
            body: JSON.stringify({model: 'claude-opus-4', messages: [{role: 'user', content: 'terra'}]}),
        })

        assert.equal(solResponse.status, 200)
        assert.equal(terraResponse.status, 200)
        assert.deepEqual(receivedModels, ['gpt-5.6-sol', 'gpt-5.6-terra'])
    } finally {
        await stopCodexRelayProxy()
        await close(upstream)
        if (oldAllowLocal === undefined) delete process.env.BRIDGE_ALLOW_LOCAL_PROVIDER
        else process.env.BRIDGE_ALLOW_LOCAL_PROVIDER = oldAllowLocal
    }
})

test('Codex relay retries an overloaded 400 response before returning success', async () => {
    const oldAllowLocal = process.env.BRIDGE_ALLOW_LOCAL_PROVIDER
    process.env.BRIDGE_ALLOW_LOCAL_PROVIDER = '1'
    let attempts = 0
    const upstream = createServer(async (req, res) => {
        for await (const _chunk of req) { /* consume request */ }
        attempts++
        if (attempts < 4) {
            res.writeHead(400, {'content-type': 'application/json', 'retry-after': '0'})
            res.end(JSON.stringify({error: {message: `Our servers are currently overloaded. Please try again later. (request id: busy-${attempts})`}}))
            return
        }
        res.writeHead(200, {'content-type': 'application/json'})
        res.end(JSON.stringify({
            id: 'resp-recovered', model: 'gpt-5.6-sol', status: 'completed',
            output: [{type: 'message', content: [{type: 'output_text', text: 'recovered'}]}],
            usage: {input_tokens: 1, output_tokens: 1},
        }))
    })
    const upstreamPort = await listen(upstream)
    const proxyPort = await reservePort()
    try {
        const relay = await startCodexRelayProxy({
            upstream: `http://127.0.0.1:${upstreamPort}/api/codex/backend-api/codex`,
            apiKey: 'relay-secret', model: 'gpt-5.6-sol', port: proxyPort,
        })
        const response = await fetch(`${getCodexRelayProxyUrl()}/v1/messages`, {
            method: 'POST',
            headers: {'content-type': 'application/json', authorization: `Bearer ${relay.token}`},
            body: JSON.stringify({model: 'claude-opus-4', messages: [{role: 'user', content: 'hello'}]}),
        })
        assert.equal(response.status, 200)
        assert.equal((await response.json()).content[0].text, 'recovered')
        assert.equal(attempts, 4)
    } finally {
        await stopCodexRelayProxy()
        await close(upstream)
        if (oldAllowLocal === undefined) delete process.env.BRIDGE_ALLOW_LOCAL_PROVIDER
        else process.env.BRIDGE_ALLOW_LOCAL_PROVIDER = oldAllowLocal
    }
})

test('Codex relay reports retry count and upstream request id after persistent overload', async () => {
    const oldAllowLocal = process.env.BRIDGE_ALLOW_LOCAL_PROVIDER
    process.env.BRIDGE_ALLOW_LOCAL_PROVIDER = '1'
    let attempts = 0
    const upstream = createServer(async (req, res) => {
        for await (const _chunk of req) { /* consume request */ }
        attempts++
        res.writeHead(400, {'content-type': 'application/json', 'retry-after': '0'})
        res.end(JSON.stringify({error: {message: 'Our servers are currently overloaded. Please try again later. (request id: req-overload-final)'}}))
    })
    const upstreamPort = await listen(upstream)
    const proxyPort = await reservePort()
    try {
        const relay = await startCodexRelayProxy({
            upstream: `http://127.0.0.1:${upstreamPort}/api/codex/backend-api/codex`,
            apiKey: 'relay-secret', model: 'gpt-5.6-sol', port: proxyPort,
        })
        const response = await fetch(`${getCodexRelayProxyUrl()}/v1/messages`, {
            method: 'POST',
            headers: {'content-type': 'application/json', authorization: `Bearer ${relay.token}`},
            body: JSON.stringify({model: 'claude-opus-4', messages: [{role: 'user', content: 'hello'}]}),
        })
        const body = await response.json()
        assert.equal(response.status, 400)
        assert.equal(attempts, 4)
        assert.match(body.error.message, /已自动尝试 4 次/)
        assert.match(body.error.message, /req-overload-final/)
        assert.match(body.error.message, /切换其他模型/)
    } finally {
        await stopCodexRelayProxy()
        await close(upstream)
        if (oldAllowLocal === undefined) delete process.env.BRIDGE_ALLOW_LOCAL_PROVIDER
        else process.env.BRIDGE_ALLOW_LOCAL_PROVIDER = oldAllowLocal
    }
})

test('Codex relay injects an explicit test-only idle delay before contacting upstream', async () => {
    const oldAllowLocal = process.env.BRIDGE_ALLOW_LOCAL_PROVIDER
    const oldFaults = process.env.BRIDGE_TEST_CODEX_RELAY_FAULTS
    const oldDelay = process.env.BRIDGE_TEST_CODEX_RELAY_IDLE_BEFORE_UPSTREAM_MS
    process.env.BRIDGE_ALLOW_LOCAL_PROVIDER = '1'
    process.env.BRIDGE_TEST_CODEX_RELAY_FAULTS = '1'
    process.env.BRIDGE_TEST_CODEX_RELAY_IDLE_BEFORE_UPSTREAM_MS = '80'
    let upstreamAt = 0
    const startedAt = Date.now()
    const upstream = createServer(async (req, res) => {
        for await (const _chunk of req) { /* consume request */ }
        upstreamAt = Date.now()
        res.writeHead(200, {'content-type': 'application/json'})
        res.end(JSON.stringify({
            id: 'resp-idle', model: 'gpt-5.6-sol', status: 'completed',
            output: [{type: 'message', content: [{type: 'output_text', text: 'after idle'}]}],
        }))
    })
    const upstreamPort = await listen(upstream)
    const proxyPort = await reservePort()
    try {
        const relay = await startCodexRelayProxy({
            upstream: `http://127.0.0.1:${upstreamPort}/api/codex/backend-api/codex`,
            apiKey: 'relay-secret', model: 'gpt-5.6-sol', port: proxyPort,
        })
        const response = await fetch(`${getCodexRelayProxyUrl()}/v1/messages`, {
            method: 'POST',
            headers: {'content-type': 'application/json', authorization: `Bearer ${relay.token}`},
            body: JSON.stringify({model: 'claude-opus-4', messages: [{role: 'user', content: 'timeout'}]}),
        })
        assert.equal(response.status, 200)
        assert.ok(upstreamAt - startedAt >= 70)
    } finally {
        await stopCodexRelayProxy()
        await close(upstream)
        if (oldAllowLocal === undefined) delete process.env.BRIDGE_ALLOW_LOCAL_PROVIDER
        else process.env.BRIDGE_ALLOW_LOCAL_PROVIDER = oldAllowLocal
        if (oldFaults === undefined) delete process.env.BRIDGE_TEST_CODEX_RELAY_FAULTS
        else process.env.BRIDGE_TEST_CODEX_RELAY_FAULTS = oldFaults
        if (oldDelay === undefined) delete process.env.BRIDGE_TEST_CODEX_RELAY_IDLE_BEFORE_UPSTREAM_MS
        else process.env.BRIDGE_TEST_CODEX_RELAY_IDLE_BEFORE_UPSTREAM_MS = oldDelay
    }
})
