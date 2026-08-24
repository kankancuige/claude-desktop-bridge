import test from 'node:test'
import assert from 'node:assert/strict'
import {createDynamicCacheRuntime} from './dynamic-cache-runtime.mjs'

test('dynamic cache runtime restores cache and selects focused query', () => {
    const sessions = new Map([['focused', {query: {id: 1}}]])
    const runtime = createDynamicCacheRuntime({cachePath: 'cache', readJSON: () => ({models: ['m']}), sessions, getFocusedSessionId: () => 'focused'})
    assert.deepEqual(runtime.dynamicCache.models, ['m'])
    assert.deepEqual(runtime.getLiveQuery(), {id: 1})
})

test('dynamic cache runtime enforces timeout', async () => {
    const runtime = createDynamicCacheRuntime({cachePath: 'cache'})
    await assert.rejects(runtime.withTimeout(new Promise(() => {}), 1), /timeout/)
})
