import assert from 'node:assert/strict'
import {SECRET_PLACEHOLDER, isSensitiveConfigKey, redactSecretMap, restoreSecretMap, restoreSecretValue} from './config-redaction.mjs'

assert.equal(isSensitiveConfigKey('ANTHROPIC_AUTH_TOKEN'), true)
assert.equal(isSensitiveConfigKey('X-API-Key'), true)
assert.equal(isSensitiveConfigKey('REGION'), false)
assert.deepEqual(redactSecretMap({ANTHROPIC_AUTH_TOKEN: 'secret', REGION: 'cn', EMPTY_TOKEN: ''}), {
    ANTHROPIC_AUTH_TOKEN: SECRET_PLACEHOLDER,
    REGION: 'cn',
    EMPTY_TOKEN: '',
})
assert.deepEqual(restoreSecretMap({ANTHROPIC_AUTH_TOKEN: SECRET_PLACEHOLDER, REGION: 'us'}, {
    ANTHROPIC_AUTH_TOKEN: 'secret',
    REGION: 'cn',
}), {ANTHROPIC_AUTH_TOKEN: 'secret', REGION: 'us'})
assert.equal(restoreSecretValue(SECRET_PLACEHOLDER, 'stored'), 'stored')
assert.equal(restoreSecretValue('', 'stored'), '')
console.log('config-redaction tests passed')
