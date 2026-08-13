import assert from 'node:assert/strict'
import {ImMessageDeduper} from './im-message-dedupe.mjs'

const d = new ImMessageDeduper({ttlMs: 100, maxEntries: 2})
assert.equal(d.add('a'), true)
assert.equal(d.add('a'), false)
assert.equal(d.has('a'), true)
assert.equal(d.add('b'), true)
assert.equal(d.add('c'), true)
assert.equal(d.has('a'), false)
d.forget('b')
assert.equal(d.add('b'), true)
console.log('im-message-dedupe tests passed')
