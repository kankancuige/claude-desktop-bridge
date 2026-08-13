import assert from 'node:assert/strict'
import {sendOrQueue, startNotificationWorker} from './notification-worker.mjs'

const queued = []
const transitions = []
let nextId = 0
const fakeOutbox = {
    enqueue: (payload, options) => {
        const id = `n${++nextId}`
        queued.push({payload, options, id})
        return {id, duplicate: false, state: 'pending'}
    },
    complete: id => { transitions.push(`complete:${id}`); return true },
    fail: id => { transitions.push(`fail:${id}`); return true },
}
assert.deepEqual(await sendOrQueue(fakeOutbox, {text: 'ok'}, async () => true), {sent: true, queued: false, id: 'n1'})
assert.deepEqual(await sendOrQueue(fakeOutbox, {text: 'retry'}, async () => false), {sent: false, queued: true, id: 'n2'})
assert.deepEqual(queued, [
    {payload: {text: 'ok'}, options: {deferMs: 30_000}, id: 'n1'},
    {payload: {text: 'retry'}, options: {deferMs: 30_000}, id: 'n2'},
])
assert.deepEqual(transitions, ['complete:n1', 'fail:n2'])
assert.deepEqual(
    await sendOrQueue({enqueue: () => null}, {text: 'disk-full'}, async () => false),
    {sent: false, queued: false, error: 'outbox_persist_failed'},
)
assert.deepEqual(
    await sendOrQueue({enqueue: () => { throw new Error('encrypt failed') }}, {text: 'direct'}, async () => true),
    {sent: true, queued: false, error: 'encrypt failed'},
)
assert.deepEqual(
    await sendOrQueue({enqueue: () => ({id: 'same', duplicate: true, state: 'sent'})}, {text: 'duplicate'}, async () => { throw new Error('must not send') }, {id: 'same'}),
    {sent: true, queued: false, id: 'same', duplicate: true},
)

let releaseDelivery
const deliveryGate = new Promise(resolve => { releaseDelivery = resolve })
let markDeliveryStarted
const deliveryStarted = new Promise(resolve => { markDeliveryStarted = resolve })
let markDeliveryFinished
const deliveryFinished = new Promise(resolve => { markDeliveryFinished = resolve })
const workerTransitions = []
const workerOutbox = {
    due: () => [{id: 'n2', payload: {text: 'in-flight'}}],
    complete: id => workerTransitions.push(`complete:${id}`),
    fail: id => workerTransitions.push(`fail:${id}`),
    summary: () => ({pending: 1, failed: 0, dead: 0, sent: 0}),
}
const worker = startNotificationWorker({
    outbox: workerOutbox,
    deliver: async () => {
        markDeliveryStarted()
        await deliveryGate
        markDeliveryFinished()
        return true
    },
    intervalMs: 60_000,
})
await deliveryStarted
worker.stop()
releaseDelivery()
await deliveryFinished
await new Promise(resolve => setTimeout(resolve, 0))
assert.deepEqual(workerTransitions, [])
console.log('notification-worker tests passed')
