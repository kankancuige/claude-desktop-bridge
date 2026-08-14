import assert from 'node:assert/strict'
import {MAX_IM_TEXT_BYTES, normalizeImMessageId, validateImText} from './im-input.mjs'

assert.equal(validateImText('hello').ok, true)
assert.equal(validateImText('   ').ok, false)
assert.equal(validateImText('中').bytes, 3)
assert.equal(validateImText('a'.repeat(MAX_IM_TEXT_BYTES + 1)).code, 'message_too_large')
assert.equal(normalizeImMessageId(1786694011644), '1786694011644')
assert.equal(normalizeImMessageId(123n), '123')
assert.equal(normalizeImMessageId(' message-1 '), 'message-1')
assert.equal(normalizeImMessageId({id: 1}), '')

console.log('im input tests passed')
