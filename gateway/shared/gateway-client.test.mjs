import assert from 'node:assert/strict'
import test from 'node:test'

import {gatewayHttpBase, gatewayWsUrl} from './gateway-client.mjs'

test('内部 Gateway 客户端使用配置端口并规范化 WS 路径', () => {
    const expectedPort = Number.parseInt(process.env.PORT || '3456', 10)
    const port = Number.isInteger(expectedPort) && expectedPort >= 1 && expectedPort <= 65535 ? expectedPort : 3456
    assert.equal(gatewayHttpBase(), `http://127.0.0.1:${port}`)
    assert.equal(gatewayWsUrl('/ws/session?source=wechat'), `ws://127.0.0.1:${port}/ws/session?source=wechat`)
    assert.equal(gatewayWsUrl('ws/control'), `ws://127.0.0.1:${port}/ws/control`)

    const originalPort = process.env.PORT
    try {
        process.env.PORT = '4123'
        assert.equal(gatewayHttpBase(), 'http://127.0.0.1:4123')
        assert.equal(gatewayWsUrl('/ws/session'), 'ws://127.0.0.1:4123/ws/session')
    } finally {
        if (originalPort === undefined) delete process.env.PORT
        else process.env.PORT = originalPort
    }
})
