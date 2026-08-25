import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionResourceRuntime} from './session-resource-runtime.mjs'

test('session resource runtime closes stream and query', async () => {
    let streamClosed = false
    let queryClosed = false
    let queryReturned = false
    const runtime = createSessionResourceRuntime({withTimeout: promise => promise, sessionCoordinator: {clearTimeout() {}}})
    const result = await runtime.closeSessionRuntime({
        pushStream: {close() {streamClosed = true}},
        query: {close() {queryClosed = true}, return() {queryReturned = true}},
    })
    assert.deepEqual(result, {pushStreamClosed: true, queryClosed: true})
    assert.equal(streamClosed, true)
    assert.equal(queryClosed, true)
    assert.equal(queryReturned, false)
})

test('session resource runtime aborts the query controller after closing the SDK query', async () => {
    const controller = new AbortController()
    let closed = false
    const runtime = createSessionResourceRuntime({withTimeout: promise => promise, sessionCoordinator: {clearTimeout() {}}})
    await runtime.closeSessionRuntime({
        queryOpts: {abortController: controller},
        query: {close() {closed = true}},
    }, {reason: 'stop_generation'})
    assert.equal(closed, true)
    assert.equal(controller.signal.aborted, true)
    assert.equal(controller.signal.reason, 'stop_generation')
})
