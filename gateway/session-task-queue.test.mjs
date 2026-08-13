import assert from 'node:assert/strict'
import {SessionTaskQueue} from './session-task-queue.mjs'

const queue = new SessionTaskQueue({maxDepth: 2})
const events = []
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const first = queue.enqueue('session-a', async () => {
    events.push('first:start')
    await wait(15)
    events.push('first:end')
    return 'ok'
})
assert.equal(queue.depth('session-a'), 1)
const second = queue.enqueue('session-a', async () => {
    events.push('second')
    return 'second-ok'
})
assert.equal(queue.depth('session-a'), 2)
await assert.rejects(() => queue.enqueue('session-a', async () => 'overflow'), error => error.code === 'queue_full')
assert.equal(await first, 'ok')
assert.equal(await second, 'second-ok')
assert.deepEqual(events, ['first:start', 'first:end', 'second'])
await wait(0)
assert.equal(queue.depth('session-a'), 0)

await assert.rejects(() => queue.enqueue('session-b', async () => {
    throw new Error('expected task failure')
}))
assert.equal(await queue.enqueue('session-b', async () => 'continues'), 'continues')
await wait(0)
assert.equal(queue.depth('session-b'), 0)

const cancelFirst = queue.enqueue('session-c', async () => {
    await wait(10)
    return 'active'
})
const cancelSecond = queue.enqueue('session-c', async () => 'must-not-run')
const cancelSecondResult = cancelSecond.catch(error => error)
queue.cancel('session-c')
assert.equal(await cancelFirst, 'active')
assert.equal((await cancelSecondResult).code, 'session_cancelled')
await wait(0)
assert.equal(queue.depth('session-c'), 0)
assert.equal(await queue.enqueue('session-c', async () => 'after-cancel'), 'after-cancel')

const allA1 = queue.enqueue('session-d', async () => { await wait(10); return 'active-d' })
const allA2 = queue.enqueue('session-d', async () => 'pending-d').catch(error => error)
const allB1 = queue.enqueue('session-e', async () => { await wait(10); return 'active-e' })
const allB2 = queue.enqueue('session-e', async () => 'pending-e').catch(error => error)
assert.equal(queue.cancelAll(), 4)
assert.equal(await allA1, 'active-d')
assert.equal((await allA2).code, 'session_cancelled')
assert.equal(await allB1, 'active-e')
assert.equal((await allB2).code, 'session_cancelled')
console.log('session-task-queue tests passed')
