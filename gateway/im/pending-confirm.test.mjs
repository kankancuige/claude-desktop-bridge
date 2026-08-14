import assert from 'node:assert/strict'
import {PendingConfirmRegistry} from './pending-confirm.mjs'

const pending = new PendingConfirmRegistry({ttlMs: 100, maxPerUser: 2, maxUsers: 2})
const first = {sessionId: 's1', requestId: 'r1', type: 'permission'}
const second = {sessionId: 's1', requestId: 'r2', type: 'choice'}

assert.equal(pending.add('u1', first), true)
assert.equal(pending.add('u1', first), false)
assert.equal(pending.add('u1', second), true)
assert.equal(pending.peek('u1').requestId, 'r1')
assert.equal(pending.remove('u1', first), true)
assert.equal(pending.peek('u1').requestId, 'r2')
assert.equal(pending.removeByRequest('s1', 'r2'), 'u1')
assert.equal(pending.peek('u1'), null)

pending.add('u1', first)
pending._users.get('u1')[0]._at = Date.now() - 1_000
pending.cleanup()
assert.equal(pending.peek('u1'), null)

pending.add('u1', first)
pending.add('u1', second)
assert.equal(pending.add('u1', {sessionId: 's1', requestId: 'r3', type: 'permission'}), false)
assert.equal(pending.peek('u1').requestId, 'r1')

console.log('pending-confirm tests passed')
