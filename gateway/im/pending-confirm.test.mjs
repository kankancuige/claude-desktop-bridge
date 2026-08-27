import assert from 'node:assert/strict'
import test from 'node:test'
import {PendingConfirmRegistry} from './pending-confirm.mjs'

test('待确认注册表去重、删除并清理超时项', () => {
    const pending = new PendingConfirmRegistry({ttlMs: 100, maxPerUser: 2, maxUsers: 2})
    const first = {sessionId: 's1', requestId: 'r1', toolUseId: 'tool-1', type: 'permission'}
    const second = {sessionId: 's1', requestId: 'r2', type: 'choice'}
    assert.equal(pending.add('u1', first).ok, true)
    assert.equal(pending.add('u1', {...first, requestId: 'another'}).reason, 'duplicate')
    assert.equal(pending.add('u1', second).ok, true)
    assert.equal(pending.remove('u1', first), true)
    assert.equal(pending.removeByRequest('s1', 'r2').userId, 'u1')
    assert.equal(pending.peek('u1'), null)

    pending.add('u1', first)
    pending._users.get('u1')[0]._at = Date.now() - 1_000
    pending.cleanup()
    assert.equal(pending.peek('u1'), null)
})

test('容量耗尽返回可展示原因，不静默丢弃确认', () => {
    const pending = new PendingConfirmRegistry({maxPerUser: 2, maxUsers: 1})
    assert.equal(pending.add('u1', {sessionId: 's1', requestId: 'r1'}).ok, true)
    assert.equal(pending.add('u1', {sessionId: 's1', requestId: 'r2'}).ok, true)
    assert.deepEqual(pending.add('u1', {sessionId: 's1', requestId: 'r3'}), {
        ok: false,
        reason: 'user_capacity',
        limit: 2,
    })
    assert.equal(pending.add('u2', {sessionId: 's2', requestId: 'r4'}).reason, 'registry_capacity')
})

test('并发确认必须按短编号匹配，裸回复不再错误消费 FIFO', () => {
    const pending = new PendingConfirmRegistry()
    const first = pending.add('u1', {sessionId: 's1', requestId: 'r1', type: 'permission'}).entry
    const second = pending.add('u1', {sessionId: 's1', requestId: 'r2', type: 'choice'}).entry
    const ambiguous = pending.matchReply('u1', '1')
    assert.equal(ambiguous.reason, 'ambiguous')
    assert.deepEqual(ambiguous.tokens, [first.replyToken, second.replyToken])
    const matched = pending.matchReply('u1', `#${second.replyToken} 2`)
    assert.equal(matched.entry.requestId, 'r2')
    assert.equal(matched.replyText, '2')
})
