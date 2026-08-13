import assert from 'node:assert/strict'
import {splitTextByUtf8Bytes} from './text-chunks.mjs'

const parts = splitTextByUtf8Bytes('中文abc中文def', 10, 0)
assert.equal(parts.join(''), '中文abc中文def')
assert.equal(parts.every(part => Buffer.byteLength(part, 'utf8') <= 64), true)
const longParts = splitTextByUtf8Bytes('中'.repeat(100), 100, 10)
assert.equal(longParts.every(part => Buffer.byteLength(part, 'utf8') <= 90), true)
console.log('text-chunks tests passed')
