import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {BridgeStateDb} from '../storage/bridge-state-db.mjs'
import {ImInbox} from './im-inbox.mjs'
import {NotificationOutbox} from './notification-outbox.mjs'

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'bridge-im-sqlite-'))
    const store = new BridgeStateDb({bridgeHome: root})
    const codec = {encode: value => `enc:${JSON.stringify(value)}`, decode: value => JSON.parse(value.slice(4))}
    return {root, store, codec}
}

test('IM inbox 从旧 JSON 惰性导入 SQLite，重启后不依赖正文文件', t => {
    const {root, store, codec} = fixture()
    t.after(() => store.close())
    const filePath = join(root, 'bridge-im-inbox.wechat.json')
    writeFileSync(filePath, JSON.stringify({version: 1, entries: {
        'wechat:message-1': {state: 'processing', at: Date.now() - 1_000, attempts: 1, payload: codec.encode({text: 'hello'})},
    }}), 'utf8')
    const inbox = new ImInbox({filePath, platform: 'wechat', payloadCodec: codec, stateStore: store, retryAfterMs: 0})
    assert.deepEqual(inbox.recoverable({olderThanMs: 0})[0].payload, {text: 'hello'})
    assert.equal(store.loadEntries('inbox', 'wechat').size, 1)
    unlinkSync(filePath)
    const restored = new ImInbox({filePath, platform: 'wechat', payloadCodec: codec, stateStore: store, retryAfterMs: 0})
    assert.equal(restored.claim('message-1').accepted, true)
    restored.complete('message-1')
    assert.equal(restored.claim('message-1').accepted, false)
})

test('通知 outbox 的状态转换通过 SQLite 持久化并可按平台隔离', t => {
    const {root, store, codec} = fixture()
    t.after(() => store.close())
    const outbox = new NotificationOutbox({filePath: join(root, 'outbox.json'), platform: 'feishu', payloadCodec: codec, stateStore: store, maxAttempts: 2})
    const id = outbox.enqueue({userId: 'u1', text: 'done'}, {id: 'notification-1'})
    assert.equal(id.id, 'notification-1')
    assert.equal(outbox.due({limit: 1})[0].payload.text, 'done')
    outbox.fail(id.id, 'timeout')
    assert.equal(outbox.summary().failed, 1)
    const restored = new NotificationOutbox({filePath: join(root, 'outbox.json'), platform: 'feishu', payloadCodec: codec, stateStore: store, maxAttempts: 2})
    assert.equal(restored.summary().failed, 1)
    assert.equal(new NotificationOutbox({filePath: join(root, 'outbox.json'), platform: 'wechat', payloadCodec: codec, stateStore: store}).summary().failed, 0)
})
