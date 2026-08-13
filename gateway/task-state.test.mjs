import test from 'node:test'
import assert from 'node:assert/strict'
import {createTaskStatePatch, recoverTaskState, isTaskResumable, taskStateForClient, taskStateFromResult, taskStateForStop, taskStateFileId, redactTaskDetail} from './task-state.mjs'

test('success is terminal and never resumable', () => {
    const state = createTaskStatePatch({status: 'succeeded', outcome: 'succeeded', resumable: true, numTurns: 3})
    assert.equal(state.outcome, 'succeeded')
    assert.equal(state.resumable, false)
    assert.equal(isTaskResumable(state), false)
})

test('running state becomes an interrupted resumable task after gateway restart', () => {
    const state = recoverTaskState({status: 'running', sdkSessionId: 'sdk-1', resumable: true}, {now: 123})
    assert.deepEqual(state, {
        version: 1,
        status: 'interrupted',
        outcome: 'failed',
        continuationReason: 'execution_error',
        resumable: true,
        subtype: null,
        sdkSessionId: 'sdk-1',
        historySessionId: null,
        numTurns: 0,
        detail: '',
        updatedAt: 123,
    })
})

test('detail is bounded and client projection excludes session identity', () => {
    const state = createTaskStatePatch({status: 'failed', detail: 'x'.repeat(5000), sdkSessionId: 'secret-sdk'})
    const client = taskStateForClient(state)
    assert.equal(client.detail.length, 2000)
    assert.equal('sdkSessionId' in client, false)
})

test('incomplete result remains resumable', () => {
    const state = createTaskStatePatch({status: 'incomplete', outcome: 'incomplete', continuationReason: 'max_turns'})
    assert.equal(state.resumable, true)
    assert.equal(isTaskResumable(state), true)
})

test('result and stop helpers keep the SDK identity for resume', () => {
    const result = taskStateFromResult({subtype: 'error_max_turns', outcome: 'incomplete', continuationReason: 'max_turns', resumable: true, numTurns: 4}, {sdkSessionId: 'sdk-2'})
    assert.equal(result.status, 'incomplete')
    assert.equal(result.historySessionId, 'sdk-2')
    const stopped = taskStateForStop({sdkSessionId: 'sdk-2'})
    assert.equal(stopped.status, 'stopped')
    assert.equal(stopped.resumable, true)
})

test('task-state persistence prefers the Gateway runtime identity', () => {
    assert.equal(taskStateFileId('gateway-1', 'sdk-1'), 'gateway-1')
    assert.equal(taskStateFileId('', 'sdk-1'), 'sdk-1')
    assert.equal(taskStateFileId('', ''), null)
})

test('persisted task detail redacts common credential forms', () => {
    const detail = redactTaskDetail('Authorization: Bearer abc.def-123 API_KEY=secret-value sk-live_123456789 https://user:pass@example.com')
    assert.equal(detail.includes('abc.def-123'), false)
    assert.equal(detail.includes('secret-value'), false)
    assert.equal(detail.includes('sk-live_123456789'), false)
    assert.equal(detail.includes('user:pass'), false)
    assert.match(detail, /\[REDACTED\]/)
})

console.log('task-state tests passed')
