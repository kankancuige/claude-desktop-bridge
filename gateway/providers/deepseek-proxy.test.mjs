import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {startDeepSeekProxy, stopDeepSeekProxy, getProxyUrl, isProxyConfiguredFor} from './deepseek-proxy.mjs'

function listen(server, port = 0) {
    return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => {
            server.removeListener('error', reject)
            resolve(server.address().port)
        })
    })
}

function close(server) {
    return new Promise((resolve) => server.close(() => resolve()))
}

async function reservePort() {
    const server = createServer()
    const port = await listen(server)
    await close(server)
    return port
}

test('DeepSeek 代理限制在校验后的上游，并支持安全切换目标', async () => {
    const oldAllowLocal = process.env.BRIDGE_ALLOW_LOCAL_PROVIDER
    const oldProxyPort = process.env.BRIDGE_DS_PORT
    process.env.BRIDGE_ALLOW_LOCAL_PROVIDER = '1'
    process.env.BRIDGE_DS_PORT = String(await reservePort())

    let firstRequest = null
    let secondRequest = null
    const upstream1 = createServer(async (req, res) => {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        firstRequest = {url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8'))}
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({content: [{type: 'text', text: 'first'}]}))
    })
    const upstream2 = createServer(async (req, res) => {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        secondRequest = {url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8'))}
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({content: [{type: 'text', text: 'second'}]}))
    })

    try {
        const port1 = await listen(upstream1)
        const port2 = await listen(upstream2)
        const target1 = `http://127.0.0.1:${port1}/anthropic`
        const target2 = `http://127.0.0.1:${port2}/anthropic`

        await startDeepSeekProxy(target1)
        assert.equal(isProxyConfiguredFor(target1), true)
        const firstResponse = await fetch(`${getProxyUrl()}/v1/messages`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                model: 'deepseek-chat',
                thinking: {type: 'disabled'},
                reasoning_effort: 'high',
                messages: [{role: 'user', content: 'hello'}],
            }),
        })
        assert.equal(firstResponse.status, 200)
        assert.equal((await firstResponse.json()).content[0].text, 'first')
        assert.equal(firstRequest.url, '/anthropic/v1/messages')
        assert.equal(firstRequest.body.thinking, undefined)

        await startDeepSeekProxy(target2)
        assert.equal(isProxyConfiguredFor(target2), true)
        const secondResponse = await fetch(`${getProxyUrl()}/v1/messages`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({model: 'deepseek-chat', messages: [{role: 'user', content: 'again'}]}),
        })
        assert.equal(secondResponse.status, 200)
        assert.equal((await secondResponse.json()).content[0].text, 'second')
        assert.equal(secondRequest.url, '/anthropic/v1/messages')
    } finally {
        await stopDeepSeekProxy()
        if (upstream1.listening) await close(upstream1)
        if (upstream2.listening) await close(upstream2)
        if (oldAllowLocal === undefined) delete process.env.BRIDGE_ALLOW_LOCAL_PROVIDER
        else process.env.BRIDGE_ALLOW_LOCAL_PROVIDER = oldAllowLocal
        if (oldProxyPort === undefined) delete process.env.BRIDGE_DS_PORT
        else process.env.BRIDGE_DS_PORT = oldProxyPort
    }
})
