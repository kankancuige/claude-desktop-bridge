import assert from 'node:assert/strict'
import test from 'node:test'
import {createMemoryRepository} from './memory-repository.mjs'

test('Memory repository 固定 memory kind 且不暴露底层 query', async () => {
    const calls = []
    const contentStore = {list: async args => { calls.push(args); return [] }, get: async () => null, put: async args => args, disable: async () => true, remove: async () => true, markUsed: async () => true, putEmbedding: async () => null, getEmbedding: async () => null, searchSimilar: async () => []}
    const repository = createMemoryRepository({contentStore})
    assert.equal(repository.query, undefined)
    await repository.list({projectKey: 'p', limit: 10})
    assert.deepEqual(calls[0], {projectKey: 'p', kind: 'memory', status: 'active', limit: 10, after: null})
})
