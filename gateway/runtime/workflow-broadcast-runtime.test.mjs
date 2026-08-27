import test from 'node:test'
import assert from 'node:assert/strict'
import {createWorkflowBroadcastRuntime} from './workflow-broadcast-runtime.mjs'

test('workflow broadcast runtime publishes lifecycle event', () => {
    const sent = []
    const runtime = createWorkflowBroadcastRuntime({
        sessions: new Map([['s', {clients: new Set()}]]), getRunState: () => null,
        broadcast: (id, message) => sent.push([id, message]), broadcastTaskLifecycle: () => {}, appendSessionEvent: () => {},
    })
    runtime.broadcastWorkflowEvent('s', {type: 'workflow_done', workflowId: 'w'})
    assert.equal(sent[0][1].workflowId, 'w')
})

test('只读 Agent 写入请求广播为 blocked 生命周期并保留请求详情', () => {
    const events = []
    const runtime = createWorkflowBroadcastRuntime({
        sessions: new Map([['s', {clients: new Set(), coordinatorTaskId: 'task-1'}]]),
        getRunState: () => null,
        getTaskCoordinator: () => ({getTaskSnapshot: () => ({plan: {steps: [{stepId: 'step-1', status: 'running'}]}})}),
        getTaskWorkbench: () => ({recordAgentEvent: (_id, event) => events.push(event)}),
        broadcast: () => {}, broadcastTaskLifecycle: () => {}, appendSessionEvent: () => {},
    })
    runtime.broadcastWorkflowEvent('s', {
        type: 'workflow_agent_blocked', workflowId: 'w', id: 'agent-1', role: 'reviewer',
        agentResult: {status: 'blocked', writeRequest: {requestedFiles: ['a.mjs']}},
    })
    assert.equal(events[0].type, 'agent/blocked')
    assert.deepEqual(events[0].result.writeRequest.requestedFiles, ['a.mjs'])
})
