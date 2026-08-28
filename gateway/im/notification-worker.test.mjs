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
assert.deepEqual(await sendOrQueue(fakeOutbox, {text: 'retry'}, async () => false), {sent: false, queued: true, id: 'n2', error: 'send_failed'})
assert.deepEqual(await sendOrQueue(fakeOutbox, {text: 'platform-error'}, async () => ({sent: false, error: 'wechat_ret_-2'})), {sent: false, queued: true, id: 'n3', error: 'wechat_ret_-2'})
assert.deepEqual(queued, [
    {payload: {text: 'ok'}, options: {deferMs: 30_000}, id: 'n1'},
    {payload: {text: 'retry'}, options: {deferMs: 30_000}, id: 'n2'},
    {payload: {text: 'platform-error'}, options: {deferMs: 30_000}, id: 'n3'},
])
assert.deepEqual(transitions, ['complete:n1', 'fail:n2', 'fail:n3'])
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
const workerStateChanges = []
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
    onStateChange: event => workerStateChanges.push(event),
    intervalMs: 60_000,
})
await deliveryStarted
worker.stop()
releaseDelivery()
await deliveryFinished
await new Promise(resolve => setTimeout(resolve, 0))
assert.deepEqual(workerTransitions, [])

const completedWorker = startNotificationWorker({
    outbox: {
        due: () => [{id: 'task-1:task_completed:part:1', payload: {text: 'done'}}],
        complete: () => true,
        fail: () => true,
        summary: () => ({}),
    },
    deliver: async () => true,
    onStateChange: event => workerStateChanges.push(event),
    intervalMs: 60_000,
})
await completedWorker.flush()
completedWorker.stop()
assert.equal(workerStateChanges.at(-1).state, 'sent')
assert.equal(workerStateChanges.at(-1).notificationId, 'task-1:task_completed')

{
    let releaseFirst
    const firstDelivery = new Promise(resolve => { releaseFirst = resolve })
    let deliveryStarted
    const started = new Promise(resolve => { deliveryStarted = resolve })
    let dueCalls = 0
    const delivered = []
    const retryWorker = startNotificationWorker({
        outbox: {
            due: () => ++dueCalls === 1
                ? [{id: 'first', payload: {text: 'first'}}]
                : dueCalls === 2 ? [{id: 'retry', payload: {text: 'retry'}}] : [],
            complete: () => true,
            fail: () => true,
            summary: () => ({}),
        },
        deliver: async payload => {
            delivered.push(payload.text)
            if (payload.text === 'first') {
                deliveryStarted()
                await firstDelivery
            }
            return true
        },
        intervalMs: 60_000,
    })
    await started
    const retryFlush = retryWorker.flush()
    releaseFirst()
    await retryFlush
    retryWorker.stop()
    assert.deepEqual(delivered, ['first', 'retry'])
}

{
    const delays = []
    const entries = [
        {id: 'n1', payload: {text: '1'}},
        {id: 'n2', payload: {text: '2'}},
        {id: 'n3', payload: {text: '3'}},
    ]
    const outbox = {
        due: () => [...entries],
        complete: id => {
            const index = entries.findIndex(entry => entry.id === id)
            if (index >= 0) entries.splice(index, 1)
            return true
        },
        fail: () => true,
        status: () => ({state: 'sent', lastError: ''}),
    }
    const worker = startNotificationWorker({outbox, deliver: async () => true, delayMs: 400, delay: async ms => delays.push(ms), intervalMs: 60_000})
    await worker.flush()
    worker.stop()
    assert.deepEqual(delays, [400, 400])
}
console.log('notification-worker tests passed')
