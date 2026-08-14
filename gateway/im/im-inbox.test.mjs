import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {claimDurableInboxMessage, ImInbox} from './im-inbox.mjs'
import {SecurePayloadCodec} from '../security/secure-payload.mjs'
import {ImMessageDeduper} from './im-message-dedupe.mjs'

const dir = mkdtempSync(join(tmpdir(), 'bridge-inbox-'))
const filePath = join(dir, 'inbox.json')
try {
    const payloadCodec = new SecurePayloadCodec(join(dir, 'key'))
    const inbox = new ImInbox({filePath, platform: 'feishu', payloadCodec, retryAfterMs: 60_000})
    assert.equal(inbox.claim('evt-1', {uid: 'u1', text: 'hello'}).accepted, true)
    assert.equal(inbox.claim('evt-1').duplicate, true)
    inbox.complete('evt-1')
    assert.equal(inbox.claim('evt-1').duplicate, true)

    const restored = new ImInbox({filePath, platform: 'feishu', payloadCodec, retryAfterMs: 60_000})
    assert.equal(restored.claim('evt-1').duplicate, true)
    assert.equal(restored.claim('').accepted, true)

    const pending = new ImInbox({filePath, platform: 'wechat', payloadCodec, retryAfterMs: 0})
    pending.claim('evt-recover', {from_user_id: 'wx1', context_token: 'ctx', item_list: []})
    assert.deepEqual(pending.recoverable()[0].payload, {from_user_id: 'wx1', context_token: 'ctx', item_list: []})

    const retryable = new ImInbox({filePath, platform: 'dingtalk', retryAfterMs: 0})
    assert.equal(retryable.claim('evt-2').accepted, true)

    const wechat = new ImInbox({filePath, platform: 'wechat'})
    const feishu = new ImInbox({filePath, platform: 'feishu'})
    wechat.claim('evt-wx')
    feishu.claim('evt-fs')
    const merged = new ImInbox({filePath, platform: 'wechat'})
    assert.equal(merged.claim('evt-wx').duplicate, true)
    const mergedFeishu = new ImInbox({filePath, platform: 'feishu'})
    assert.equal(mergedFeishu.claim('evt-fs').duplicate, true)
    retryable.fail('evt-2', {code: 'queue_full'})
    assert.equal(retryable.claim('evt-2').accepted, true)

    const expiringFile = join(dir, 'expiring-inbox.json')
    writeFileSync(expiringFile, JSON.stringify({entries: {
        'wechat:old': {state: 'completed', at: Date.now() - 10_000},
        'feishu:keep': {state: 'completed', at: Date.now()},
    }}))
    const expiring = new ImInbox({filePath: expiringFile, platform: 'wechat', ttlMs: 1_000})
    expiring.claim('fresh')
    const expiringDisk = JSON.parse(readFileSync(expiringFile, 'utf8')).entries
    assert.equal(expiringDisk['wechat:old'], undefined)
    assert.equal(expiringDisk['feishu:keep'].state, 'completed')

    const corruptFile = join(dir, 'corrupt-inbox.json')
    writeFileSync(corruptFile, '{invalid')
    let corruptErrors = 0
    const repaired = new ImInbox({
        filePath: corruptFile, platform: 'wechat', payloadCodec,
        onPersistError: () => { corruptErrors++ },
    })
    assert.equal(repaired.claim('evt-after-corruption', {text: 'ok'}).persistent, true)
    assert.equal(corruptErrors, 1)
    assert.equal(readdirSync(dir).some(name => name.startsWith('corrupt-inbox.json.corrupt-')), true)

    const blockedParent = join(dir, 'blocked-inbox-parent')
    writeFileSync(blockedParent, 'not a directory')
    let persistErrors = 0
    const nonPersistent = new ImInbox({
        filePath: join(blockedParent, 'inbox.json'), platform: 'wechat', payloadCodec,
        onPersistError: () => { persistErrors++ },
    })
    const nonPersistentClaim = nonPersistent.claim('evt-memory-only', {text: 'hello'})
    assert.equal(nonPersistentClaim.accepted, true)
    assert.equal(nonPersistentClaim.persistent, false)
    assert.equal(persistErrors, 1)

    let capacityErrors = 0
    const capacityInbox = new ImInbox({
        filePath: join(dir, 'capacity-inbox.json'), platform: 'wechat', maxEntries: 1,
        onPersistError: error => { if (error?.code === 'inbox_capacity_exceeded') capacityErrors++ },
    })
    assert.equal(capacityInbox.claim('kept').persistent, true)
    assert.deepEqual(capacityInbox.claim('rejected'), {accepted: true, persistent: false, capacityExceeded: true})
    assert.equal(capacityInbox.claim('kept').duplicate, true)
    assert.equal(capacityErrors, 1)

    const legacyFile = join(dir, 'legacy-inbox.json')
    const migratedFile = join(dir, 'wechat-inbox.json')
    writeFileSync(legacyFile, JSON.stringify({entries: {
        'wechat:legacy-wx': {state: 'completed', at: Date.now()},
        'feishu:legacy-fs': {state: 'completed', at: Date.now()},
    }}))
    const migrated = new ImInbox({
        filePath: migratedFile, legacyFilePath: legacyFile, platform: 'wechat', payloadCodec,
    })
    assert.equal(migrated.claim('legacy-wx').duplicate, true)
    const migratedEntries = JSON.parse(readFileSync(migratedFile, 'utf8')).entries
    assert.equal(migratedEntries['wechat:legacy-wx'].state, 'completed')
    assert.equal(migratedEntries['feishu:legacy-fs'], undefined)

    const durableDeduper = new ImMessageDeduper()
    const nonDurableInbox = {claim: () => ({accepted: true, persistent: false})}
    assert.throws(() => claimDurableInboxMessage({
        inbox: nonDurableInbox, deduper: durableDeduper, messageId: 'evt-sync-fail', payload: {text: 'x'},
    }), error => error?.code === 'inbox_persist_failed')
    assert.throws(() => claimDurableInboxMessage({
        inbox: nonDurableInbox, deduper: durableDeduper, messageId: 'evt-sync-fail', payload: {text: 'x'},
    }), error => error?.code === 'inbox_persist_failed')
    console.log('im-inbox tests passed')
} finally {
    rmSync(dir, {recursive: true, force: true})
}
