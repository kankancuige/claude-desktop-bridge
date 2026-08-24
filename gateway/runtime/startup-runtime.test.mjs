import test from 'node:test'
import assert from 'node:assert/strict'
import {createStartupRuntime} from './startup-runtime.mjs'

test('startup runtime validates required boundaries', () => {
    assert.throws(() => createStartupRuntime(), /startup runtime dependencies are required/)
})
