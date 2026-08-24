import assert from 'node:assert/strict'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {claimDurableInboxMessage, ImInbox} from './im-inbox.mjs'
import {SecurePayloadCodec} from '../security/secure-payload.mjs'
import {ImMessageDeduper} from './im-message-dedupe.mjs'

function repository() {
    const buckets = new Map()
    let failWrites = false
    return {
        loadEntries({kind, platform}) { return new Map(buckets.get(`${kind}:${platform}`) || []) },
        replaceEntries({kind, platform, entries}) {
            if (failWrites) throw new Error('repository write failed')
            buckets.set(`${kind}:${platform}`, new Map(entries))
            return true
        },
        seed(kind, platform, entries) { buckets.set(`${kind}:${platform}`, new Map(Object.entries(entries))) },
        setFailWrites(value) { failWrites = value },
    }
}

const root = join(tmpdir(), `bridge-inbox-${Date.now()}`)
const payloadCodec = new SecurePayloadCodec(join(root, 'key'))
const store = repository()
const inbox = new ImInbox({repository: store, platform: 'feishu', payloadCodec, retryAfterMs: 60_000})
assert.equal(inbox.claim('evt-1', {uid: 'u1', text: 'hello'}).accepted, true)
assert.equal(inbox.claim('evt-1').duplicate, true)
inbox.complete('evt-1')
assert.equal(inbox.claim('evt-1').duplicate, true)

const restored = new ImInbox({repository: store, platform: 'feishu', payloadCodec, retryAfterMs: 60_000})
assert.equal(restored.claim('evt-1').duplicate, true)
assert.equal(restored.claim('').accepted, true)

const pending = new ImInbox({repository: store, platform: 'wechat', payloadCodec, retryAfterMs: 0})
pending.claim('evt-recover', {from_user_id: 'wx1', context_token: 'ctx', item_list: []})
assert.deepEqual(pending.recoverable()[0].payload, {from_user_id: 'wx1', context_token: 'ctx', item_list: []})

const retryable = new ImInbox({repository: store, platform: 'dingtalk', retryAfterMs: 0})
assert.equal(retryable.claim('evt-2').accepted, true)
retryable.fail('evt-2', {code: 'queue_full'})
assert.equal(retryable.claim('evt-2').accepted, true)

const wechat = new ImInbox({repository: store, platform: 'wechat'})
const feishu = new ImInbox({repository: store, platform: 'feishu'})
wechat.claim('evt-wx')
feishu.claim('evt-fs')
assert.equal(new ImInbox({repository: store, platform: 'wechat'}).claim('evt-wx').duplicate, true)
assert.equal(new ImInbox({repository: store, platform: 'feishu'}).claim('evt-fs').duplicate, true)

store.seed('inbox', 'wechat', {'wechat:old': {state: 'completed', at: Date.now() - 10_000}, 'wechat:keep': {state: 'completed', at: Date.now()}})
const expiring = new ImInbox({repository: store, platform: 'wechat', ttlMs: 1_000})
assert.equal(expiring.claim('fresh').persistent, true)
assert.equal(store.loadEntries({kind: 'inbox', platform: 'wechat'}).has('wechat:old'), false)
assert.equal(store.loadEntries({kind: 'inbox', platform: 'wechat'}).get('wechat:keep').state, 'completed')

let persistErrors = 0
store.setFailWrites(true)
const nonPersistent = new ImInbox({repository: store, platform: 'dingtalk', onPersistError: () => { persistErrors++ }})
assert.equal(nonPersistent.claim('evt-memory-only', {text: 'hello'}).persistent, false)
assert.equal(persistErrors, 1)
store.setFailWrites(false)

let capacityErrors = 0
const capacityInbox = new ImInbox({repository: store, platform: 'capacity', maxEntries: 1, onPersistError: error => { if (error?.code === 'inbox_capacity_exceeded') capacityErrors++ }})
assert.equal(capacityInbox.claim('kept').persistent, true)
assert.deepEqual(capacityInbox.claim('rejected'), {accepted: true, persistent: false, capacityExceeded: true})
assert.equal(capacityErrors, 1)
assert.throws(() => new ImInbox({platform: 'wechat'}), /platform and repository are required/)

const durableDeduper = new ImMessageDeduper()
const nonDurableInbox = {claim: () => ({accepted: true, persistent: false})}
assert.throws(() => claimDurableInboxMessage({inbox: nonDurableInbox, deduper: durableDeduper, messageId: 'evt-sync-fail', payload: {text: 'x'}}), error => error?.code === 'inbox_persist_failed')
assert.throws(() => claimDurableInboxMessage({inbox: nonDurableInbox, deduper: durableDeduper, messageId: 'evt-sync-fail', payload: {text: 'x'}}), error => error?.code === 'inbox_persist_failed')
console.log('im-inbox tests passed')
