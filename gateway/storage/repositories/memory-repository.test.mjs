import assert from 'node:assert/strict'
import test from 'node:test'
import {createMemoryRepository} from './memory-repository.mjs'

test('Memory Repository 暴露受控的层级和子节点查询', async () => {
    const calls = []
    const contentStore = {
        list: async args => { calls.push(['list', args]); return [] },
        get: async () => ({sourceKey: 'memory/a.md', body: '正文', metadata: {l0: '摘要'}}),
        put: async row => row,
        markUsed: async () => true,
        count: async args => { calls.push(['count', args]); return 3 },
        listChildren: async args => { calls.push(['children', args]); return [{sourceKey: 'memory/b.md'}] },
        load: async args => { calls.push(['load', args]); return {selectedTier: args.tier} },
    }
    const repository = createMemoryRepository({contentStore})
    assert.equal(await repository.count({projectKey: 'p'}), 3)
    assert.deepEqual(await repository.listChildren({projectKey: 'p', parentKey: 'memory/a.md'}), [{sourceKey: 'memory/b.md'}])
    assert.deepEqual(await repository.load({projectKey: 'p', sourceKey: 'memory/a.md', tier: 'l0'}), {selectedTier: 'l0'})
    assert.equal(calls[0][1].kind, 'memory')
    assert.equal(calls[1][1].parentKey, 'memory/a.md')
})
