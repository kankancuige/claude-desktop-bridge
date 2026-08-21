import assert from 'node:assert/strict'
import test from 'node:test'
import {createSessionCoordinator} from './session-coordinator.mjs'

test('重建协调器将同一 session 的补充输入串行归并', () => {
    const coordinator = createSessionCoordinator()
    const session = {}
    const first = coordinator.beginRebuild(session, 'first')
    assert.equal(first.started, true)
    assert.equal(coordinator.enqueue(session, 'second'), true)
    assert.deepEqual(coordinator.consumePendingMessages(session, first.token), ['first', 'second'])
    assert.equal(coordinator.complete(session, first.token), true)
    assert.equal(session._rebuildPromise, null)
    assert.equal(session._rebuildId, null)
})

test('取消和过期重建不会覆盖后继 rebuild 状态', () => {
    const coordinator = createSessionCoordinator()
    const session = {}
    const first = coordinator.beginRebuild(session, 'first')
    coordinator.invalidate(session)
    assert.equal(coordinator.isCurrent(session, first.token), false)
    const second = coordinator.beginRebuild(session, 'second')
    assert.equal(coordinator.fail(session, first.token), false)
    assert.equal(coordinator.isCurrent(session, second.token), true)
    assert.equal(coordinator.fail(session, second.token), true)
    assert.equal(session._pendingMessages, null)
})
