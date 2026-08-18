import test from 'node:test'
import assert from 'node:assert/strict'
import {
    extractBridgeProviderSettings,
    hasBridgeProviderSettings,
    normalizeBridgeProviderSettings,
    overlayBridgeProviderSettings,
    stripBridgeProviderSettings,
} from './bridge-provider-settings.mjs'

test('provider settings normalize API key aliases into one auth token', () => {
    assert.deepEqual(normalizeBridgeProviderSettings({
        model: 'gpt-5.6-sol',
        env: {ANTHROPIC_BASE_URL: ' https://relay.example/v1 ', ANTHROPIC_API_KEY: ' key '},
    }), {
        model: 'gpt-5.6-sol',
        env: {ANTHROPIC_BASE_URL: 'https://relay.example/v1', ANTHROPIC_AUTH_TOKEN: 'key'},
    })
})

test('bridge provider overlays only the provider fields', () => {
    const result = overlayBridgeProviderSettings({
        theme: 'dark',
        env: {PATH: 'kept', ANTHROPIC_BASE_URL: 'old'},
    }, {
        model: 'gpt-5.6-sol',
        env: {ANTHROPIC_BASE_URL: 'https://relay.example/v1', ANTHROPIC_AUTH_TOKEN: 'secret'},
    })
    assert.equal(result.theme, 'dark')
    assert.equal(result.env.PATH, 'kept')
    assert.equal(result.env.ANTHROPIC_BASE_URL, 'https://relay.example/v1')
    assert.equal(result.env.ANTHROPIC_AUTH_TOKEN, 'secret')
    assert.equal(result.model, 'gpt-5.6-sol')
})

test('redacted provider token is restored from bridge-owned settings', () => {
    assert.deepEqual(extractBridgeProviderSettings({
        model: 'gpt-5.6-sol',
        env: {ANTHROPIC_BASE_URL: 'https://relay.example/v1', ANTHROPIC_AUTH_TOKEN: '[REDACTED]'},
    }, {
        env: {ANTHROPIC_AUTH_TOKEN: 'bridge-secret'},
    }).env.ANTHROPIC_AUTH_TOKEN, 'bridge-secret')
})

test('empty provider settings are distinguishable from a configured provider', () => {
    assert.equal(hasBridgeProviderSettings({}), false)
    assert.equal(hasBridgeProviderSettings({env: {ANTHROPIC_BASE_URL: 'https://relay.example'}}), true)
})

test('settings persistence removes every provider-owned field', () => {
    assert.deepEqual(stripBridgeProviderSettings({
        theme: 'dark',
        model: 'gpt-5.6-sol',
        env: {
            PATH: 'kept',
            ANTHROPIC_BASE_URL: 'https://relay.example/v1',
            ANTHROPIC_AUTH_TOKEN: 'secret',
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.6-sol',
        },
    }), {
        theme: 'dark',
        env: {PATH: 'kept'},
    })
})
