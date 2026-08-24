import test from 'node:test'
import assert from 'node:assert/strict'
import {createGatewayServiceRuntime} from './gateway-service-runtime.mjs'

test('Gateway service 通过显式端口访问仓储和 Agent', () => {
    const calls = []
    const runtime = createGatewayServiceRuntime({getStorageGateway: () => ({repositories: {sessions: true}}), agentProvider: {start: (...args) => { calls.push(args); return 'query' }}, requirementsForAgentStart: value => ({...value, required: true})})
    assert.deepEqual(runtime.stateRepositories(), {sessions: true})
    assert.equal(runtime.startClaudeAgent('prompt', {model: 'x'}), 'query')
    assert.equal(calls.length, 1)
})
