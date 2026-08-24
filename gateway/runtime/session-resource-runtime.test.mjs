import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionResourceRuntime} from './session-resource-runtime.mjs'

test('session resource runtime closes stream and query', async () => {
    let streamClosed = false
    let queryClosed = false
    const runtime = createSessionResourceRuntime({withTimeout: promise => promise, sessionCoordinator: {clearTimeout() {}}})
    const result = await runtime.closeSessionRuntime({pushStream: {close() {streamClosed = true}}, query: {return() {queryClosed = true}}})
    assert.deepEqual(result, {pushStreamClosed: true, queryClosed: true})
    assert.equal(streamClosed, true)
    assert.equal(queryClosed, true)
})
