import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {NotificationOutbox, readNotificationSummary} from './notification-outbox.mjs'
import {SecurePayloadCodec} from './secure-payload.mjs'

const dir = mkdtempSync(join(tmpdir(), 'bridge-outbox-'))
try {
    const payloadCodec = new SecurePayloadCodec(join(dir, 'key'))
    const filePath = join(dir, 'outbox.json')
    const outbox = new NotificationOutbox({filePath, platform: 'feishu', payloadCodec})
    const id = outbox.enqueue({userId: 'u1', text: 'done'})
    assert.deepEqual(outbox.summary(), {pending: 1, failed: 0, dead: 0, sent: 0})
    assert.deepEqual(outbox.due()[0].payload, {userId: 'u1', text: 'done'})
    outbox.fail(id, 'network')
    assert.equal(outbox.due().length, 0)
    outbox.complete(id)
    assert.deepEqual(outbox.summary(), {pending: 0, failed: 0, dead: 0, sent: 1})

    const leased = new NotificationOutbox({filePath: join(dir, 'leased.json'), platform: 'feishu', payloadCodec})
    leased.enqueue({userId: 'u2', text: 'later'}, {deferMs: 60_000})
    assert.equal(leased.due().length, 0)

    const wechat = new NotificationOutbox({filePath, platform: 'wechat', payloadCodec})
    wechat.enqueue({userId: 'wx1', text: 'ok'})
    const restored = new NotificationOutbox({filePath, platform: 'feishu', payloadCodec})
    assert.equal(restored.summary().sent, 1)
    assert.equal(new NotificationOutbox({filePath, platform: 'wechat', payloadCodec}).summary().pending, 1)

    const dead = new NotificationOutbox({filePath: join(dir, 'dead.json'), platform: 'wechat', payloadCodec, maxAttempts: 2})
    const deadId = dead.enqueue({text: 'never'})
    dead.fail(deadId, 'first')
    dead.fail(deadId, 'second')
    assert.deepEqual(dead.summary(), {pending: 0, failed: 0, dead: 1, sent: 0})
    assert.equal(dead.due().length, 0)
    assert.equal(dead.retryFailed(), 1)
    assert.deepEqual(dead.summary(), {pending: 1, failed: 0, dead: 0, sent: 0})
    dead.fail(deadId, 'first-again')
    dead.fail(deadId, 'second-again')
    assert.equal(dead.discard(), 1)
    assert.deepEqual(dead.summary(), {pending: 0, failed: 0, dead: 0, sent: 0})

    const expiringFile = join(dir, 'expiring-outbox.json')
    writeFileSync(expiringFile, JSON.stringify({entries: {
        'wechat:old': {platform: 'wechat', state: 'sent', createdAt: 1, updatedAt: 1},
        'feishu:keep': {
            platform: 'feishu', state: 'failed', attempts: 1, nextAttemptAt: Date.now() + 60_000,
            createdAt: Date.now(), updatedAt: Date.now(), payload: payloadCodec.encode({text: 'keep'}),
        },
    }}))
    const expiring = new NotificationOutbox({filePath: expiringFile, platform: 'wechat', payloadCodec, sentTtlMs: 1})
    expiring.enqueue({text: 'fresh'})
    const expiringDisk = JSON.parse(readFileSync(expiringFile, 'utf8')).entries
    assert.equal(expiringDisk['wechat:old'], undefined)
    assert.equal(expiringDisk['feishu:keep'].state, 'failed')
    assert.deepEqual(readNotificationSummary(expiringFile, 'feishu'), {pending: 0, failed: 1, dead: 0, sent: 0})

    const corruptFile = join(dir, 'corrupt-outbox.json')
    writeFileSync(corruptFile, '{invalid')
    let corruptErrors = 0
    const repaired = new NotificationOutbox({
        filePath: corruptFile, platform: 'wechat', payloadCodec,
        onPersistError: () => { corruptErrors++ },
    })
    assert.ok(repaired.enqueue({text: 'after corruption'}))
    assert.equal(corruptErrors, 1)
    assert.equal(readdirSync(dir).some(name => name.startsWith('corrupt-outbox.json.corrupt-')), true)

    const blockedParent = join(dir, 'blocked-outbox-parent')
    writeFileSync(blockedParent, 'not a directory')
    let persistErrors = 0
    const nonPersistent = new NotificationOutbox({
        filePath: join(blockedParent, 'outbox.json'), platform: 'wechat', payloadCodec,
        onPersistError: () => { persistErrors++ },
    })
    assert.equal(nonPersistent.enqueue({text: 'lost'}), null)
    assert.deepEqual(nonPersistent.summary(), {pending: 0, failed: 0, dead: 0, sent: 0})
    assert.equal(persistErrors, 1)

    let capacityErrors = 0
    const capacityOutbox = new NotificationOutbox({
        filePath: join(dir, 'capacity-outbox.json'), platform: 'wechat', payloadCodec, maxEntries: 1,
        onPersistError: error => { if (error?.code === 'outbox_capacity_exceeded') capacityErrors++ },
    })
    const keptId = capacityOutbox.enqueue({text: 'kept'})
    assert.ok(keptId)
    assert.equal(capacityOutbox.enqueue({text: 'rejected'}), null)
    assert.deepEqual(capacityOutbox.due()[0].payload, {text: 'kept'})
    assert.equal(capacityErrors, 1)
    capacityOutbox.complete(keptId)
    assert.ok(capacityOutbox.enqueue({text: 'after-sent'}))

    const legacyFile = join(dir, 'legacy-outbox.json')
    const migratedFile = join(dir, 'wechat-outbox.json')
    writeFileSync(legacyFile, JSON.stringify({entries: {
        'wechat:legacy-wx': {
            platform: 'wechat', state: 'pending', attempts: 0, nextAttemptAt: 0,
            createdAt: Date.now(), updatedAt: Date.now(), payload: payloadCodec.encode({text: 'legacy'}),
        },
        'feishu:legacy-fs': {
            platform: 'feishu', state: 'sent', attempts: 0,
            createdAt: Date.now(), updatedAt: Date.now(),
        },
    }}))
    const migrated = new NotificationOutbox({
        filePath: migratedFile, legacyFilePath: legacyFile, platform: 'wechat', payloadCodec,
    })
    assert.deepEqual(migrated.due()[0].payload, {text: 'legacy'})
    const migratedEntries = JSON.parse(readFileSync(migratedFile, 'utf8')).entries
    assert.equal(migratedEntries['wechat:legacy-wx'].state, 'pending')
    assert.equal(migratedEntries['feishu:legacy-fs'], undefined)
    console.log('notification-outbox tests passed')
} finally {
    rmSync(dir, {recursive: true, force: true})
}
