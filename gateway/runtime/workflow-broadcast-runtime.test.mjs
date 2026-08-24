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
