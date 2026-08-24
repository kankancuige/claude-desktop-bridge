import test from 'node:test'
import assert from 'node:assert/strict'
import {createSecurePayloadRuntime} from './secure-payload-runtime.mjs'

test('secure payload runtime consumes environment key', async () => {
    let configured = null
    const env = {BRIDGE_SECURE_PAYLOAD_KEY: 'secret'}
    const runtime = createSecurePayloadRuntime({env, configureSecurePayloadMasterKey: value => {configured = value}, processLike: {}})
    assert.equal(await runtime.initializeSecurePayloadKey(), true)
    assert.equal(configured, 'secret')
    assert.equal(env.BRIDGE_SECURE_PAYLOAD_KEY, undefined)
})
