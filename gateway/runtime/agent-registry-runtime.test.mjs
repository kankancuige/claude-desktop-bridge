import test from 'node:test'
import assert from 'node:assert/strict'
import {createAgentRegistryRuntime} from './agent-registry-runtime.mjs'

test('agent registry runtime loads frontmatter definitions', () => {
    const runtime = createAgentRegistryRuntime({
        bridgeHome: 'D:/bridge', builtinDefinitions: [{id: 'general-purpose'}],
        createAgentRegistry: value => value, getBuiltinResourceState: () => [], resolveTaskAgents: () => [],
        readdirSync: () => ['reviewer.md'], readFileSync: () => '---\nname: reviewer\ndescription: Review\n---\nDo review',
        join: (...parts) => parts.join('/'), parseFrontmatter: content => ({frontmatter: {name: 'reviewer', description: 'Review'}, body: 'Do review'}),
    })
    assert.equal(runtime.loadAgentDefinitions().reviewer.prompt, 'Do review')
    assert.equal(runtime.createRuntimeAgentRegistry().custom[0].writable, false)
})
