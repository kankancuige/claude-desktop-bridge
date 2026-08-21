import assert from 'node:assert/strict'
import test from 'node:test'
import {createAgentRegistry, resolveAgents} from './agent-registry.mjs'

test('按复杂度、动作和风险选择有限角色', () => {
    assert.deepEqual(resolveAgents({}, {complexity: 'light', action: 'query'}), [])
    assert.deepEqual(resolveAgents({}, {complexity: 'light', action: 'inspect'}).map(item => item.role), ['explorer'])
    assert.deepEqual(resolveAgents({}, {complexity: 'balanced', action: 'implement'}).map(item => item.role), ['developer', 'test-engineer'])
    const power = resolveAgents({}, {complexity: 'power', action: 'refactor', risk: 'critical'})
    assert.ok(power.length <= 8)
    assert.ok(power.some(item => item.role === 'security-reviewer'))
})

test('用户 Agent 与内置 Agent 来源分离且可关闭', () => {
    const registry = createAgentRegistry({custom: [{id: 'my-agent', role: 'developer', enabled: false}]})
    assert.equal(registry.get('my-agent').source, 'user')
    assert.equal(registry.list({enabledOnly: true}).some(item => item.id === 'my-agent'), false)
})
