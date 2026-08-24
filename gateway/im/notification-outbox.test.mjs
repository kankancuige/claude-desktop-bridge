import assert from 'node:assert/strict'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {NotificationOutbox} from './notification-outbox.mjs'
import {SecurePayloadCodec} from '../security/secure-payload.mjs'

function createRepository() {
    const buckets = new Map()
    let failWrites = false
    return {
        loadEntries({kind, platform}) {
            return new Map(buckets.get(`${kind}:${platform}`) || [])
        },
        replaceEntries({kind, platform, entries}) {
            if (failWrites) throw new Error('repository write failed')
            buckets.set(`${kind}:${platform}`, new Map(entries))
            return true
        },
        setFailWrites(value) { failWrites = value },
    }
}

const repository = createRepository()
const payloadCodec = new SecurePayloadCodec(join(tmpdir(), `bridge-outbox-key-${Date.now()}`))

const outbox = new NotificationOutbox({platform: 'feishu', payloadCodec, repository})
const id = outbox.enqueue({userId: 'u1', text: 'done'})
assert.deepEqual(outbox.summary(), {pending: 1, failed: 0, dead: 0, sent: 0})
assert.deepEqual(outbox.due()[0].payload, {userId: 'u1', text: 'done'})
assert.deepEqual(outbox.enqueue({text: 'duplicate'}, {id}), {id, duplicate: true, state: 'pending'})
assert.equal(outbox.fail(id, 'network'), true)
assert.equal(outbox.due().length, 0)
assert.equal(outbox.complete(id), true)
assert.deepEqual(outbox.summary(), {pending: 0, failed: 0, dead: 0, sent: 1})

const restored = new NotificationOutbox({platform: 'feishu', payloadCodec, repository})
assert.deepEqual(restored.summary(), {pending: 0, failed: 0, dead: 0, sent: 1})
const leased = new NotificationOutbox({platform: 'wechat', payloadCodec, repository})
leased.enqueue({userId: 'u2'}, {deferMs: 60_000})
assert.equal(leased.due().length, 0)

const dead = new NotificationOutbox({platform: 'dingtalk', payloadCodec, repository, maxAttempts: 2})
const deadId = dead.enqueue({text: 'never'})
assert.equal(dead.fail(deadId, 'first'), true)
assert.equal(dead.fail(deadId, 'second'), true)
assert.deepEqual(dead.summary(), {pending: 0, failed: 0, dead: 1, sent: 0})
assert.equal(dead.due().length, 0)
assert.equal(dead.retryFailed(), 1)
assert.deepEqual(dead.summary(), {pending: 1, failed: 0, dead: 0, sent: 0})
assert.equal(dead.fail(deadId, 'first-again'), true)
assert.equal(dead.fail(deadId, 'second-again'), true)
assert.equal(dead.discard(), 1)
assert.deepEqual(dead.summary(), {pending: 0, failed: 0, dead: 0, sent: 0})

const multipart = new NotificationOutbox({platform: 'wechat', payloadCodec, repository})
multipart.enqueue({text: 'one'}, {id: 'task-2:completed:part:1'})
multipart.enqueue({text: 'two'}, {id: 'task-2:completed:part:2'})
assert.equal(multipart.complete('task-2:completed:part:1'), true)
assert.deepEqual(multipart.status('task-2:completed'), {state: 'pending', lastError: ''})
assert.equal(multipart.fail('task-2:completed:part:2', 'network'), true)
assert.deepEqual(multipart.status('task-2:completed'), {state: 'failed', lastError: 'network'})
assert.equal(multipart.complete('task-2:completed:part:2'), true)
assert.deepEqual(multipart.status('task-2:completed'), {state: 'sent', lastError: ''})

let capacityErrors = 0
const capacity = new NotificationOutbox({
    platform: 'capacity', payloadCodec, repository, maxEntries: 1,
    onPersistError: error => { if (error?.code === 'outbox_capacity_exceeded') capacityErrors++ },
})
const keptId = capacity.enqueue({text: 'kept'})
assert.ok(keptId)
assert.equal(capacity.enqueue({text: 'rejected'}), null)
assert.equal(capacityErrors, 1)
assert.equal(capacity.complete(keptId), true)
assert.ok(capacity.enqueue({text: 'after-sent'}))

let persistErrors = 0
repository.setFailWrites(true)
const nonPersistent = new NotificationOutbox({
    platform: 'failed', payloadCodec, repository,
    onPersistError: () => { persistErrors++ },
})
assert.equal(nonPersistent.enqueue({text: 'lost'}), null)
assert.deepEqual(nonPersistent.summary(), {pending: 0, failed: 0, dead: 0, sent: 0})
assert.equal(persistErrors, 1)
repository.setFailWrites(false)

assert.throws(() => new NotificationOutbox({platform: 'wechat', payloadCodec}), /repository are required/)
console.log('notification-outbox tests passed')
