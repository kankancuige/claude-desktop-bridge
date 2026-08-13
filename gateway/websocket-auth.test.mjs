import assert from 'node:assert/strict'
import {BRIDGE_WS_PROTOCOL, buildWebSocketProtocols, extractWebSocketToken} from './websocket-auth.mjs'

assert.equal(extractWebSocketToken({headers: {'x-bridge-token': 'header-token'}, url: '/ws/a?token=query-token'}), 'header-token')
assert.equal(extractWebSocketToken({headers: {'sec-websocket-protocol': `${BRIDGE_WS_PROTOCOL}, claude-bridge-auth.protocol-token`}, url: '/ws/a'}), 'protocol-token')
assert.equal(extractWebSocketToken({headers: {}, url: '/ws/a?token=query-token'}), '')
assert.deepEqual(buildWebSocketProtocols('abc-123'), [BRIDGE_WS_PROTOCOL, 'claude-bridge-auth.abc-123'])
assert.deepEqual(buildWebSocketProtocols(''), [])
console.log('websocket-auth tests passed')
