import assert from 'node:assert/strict'
import {MAX_IM_TEXT_BYTES, validateImText} from './im-input.mjs'

assert.equal(validateImText('hello').ok, true)
assert.equal(validateImText('   ').ok, false)
assert.equal(validateImText('中').bytes, 3)
assert.equal(validateImText('a'.repeat(MAX_IM_TEXT_BYTES + 1)).code, 'message_too_large')

console.log('im input tests passed')
