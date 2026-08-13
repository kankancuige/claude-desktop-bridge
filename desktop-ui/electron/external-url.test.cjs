const assert = require('node:assert/strict')
const {normalizeExternalUrl} = require('./external-url.cjs')

assert.equal(normalizeExternalUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1')
assert.equal(normalizeExternalUrl('http://127.0.0.1:3456/path'), 'http://127.0.0.1:3456/path')
assert.equal(normalizeExternalUrl('file:///C:/Windows/System32'), null)
assert.equal(normalizeExternalUrl('javascript:alert(1)'), null)
assert.equal(normalizeExternalUrl('https://user:pass@example.com/'), null)
assert.equal(normalizeExternalUrl('https://example.com/\nsecond'), null)
assert.equal(normalizeExternalUrl('https://example.com/' + 'a'.repeat(2100)), null)

console.log('external-url tests passed')
