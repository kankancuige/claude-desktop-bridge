import assert from 'node:assert/strict'
import {createMirrorStateResolver} from './mirror-state.mjs'

let calls = 0
let release
const resolver = createMirrorStateResolver(() => {
    calls++
    return new Promise(resolve => { release = resolve })
})

const first = resolver.resolve()
const second = resolver.resolve()
assert.equal(calls, 0)
await Promise.resolve()
assert.equal(calls, 1)

resolver.set(true)
release(false)
assert.equal(await first, true)
assert.equal(await second, true)
assert.equal(await resolver.resolve(), true)
assert.equal(calls, 1)

const falseResolver = createMirrorStateResolver(async () => false)
assert.equal(await falseResolver.resolve(), false)
assert.equal(falseResolver.known, true)

console.log('mirror-state tests passed')
