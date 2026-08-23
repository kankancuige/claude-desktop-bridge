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

test('Coordinator 统一保存 context policy、取消原因和可观察快照', () => {
    const coordinator = createSessionCoordinator()
    const session = {}
    coordinator.setContextPolicy(session, {mode: 'handoff_summary', cacheEligibility: 'cross_model_unavailable'})
    coordinator.beginTurn(session)
    assert.equal(coordinator.snapshot(session).contextPolicy.mode, 'handoff_summary')
    coordinator.cancel(session, 'timeout')
    assert.deepEqual(coordinator.snapshot(session), {
        rebuilding: false,
        rebuildId: null,
        pendingMessages: 0,
        cancelled: true,
        cancelReason: 'timeout',
        timeoutActive: false,
        timeoutReason: null,
        contextPolicy: {mode: 'handoff_summary', cacheEligibility: 'cross_model_unavailable'},
    })
})

test('timeout 归属 Coordinator，过期 query 和取消后均不能触发 timeout', () => {
    const coordinator = createSessionCoordinator()
    const session = {}
    const query = {}
    assert.equal(coordinator.beginTimeout(session, query, 'stream_idle_timeout'), true)
    assert.equal(coordinator.isTimeoutCurrent(session, query), true)
    assert.equal(coordinator.isTimeoutCurrent(session, {}), false)
    assert.equal(coordinator.snapshot(session).timeoutReason, 'stream_idle_timeout')
    coordinator.cancel(session, 'user_stop')
    assert.equal(coordinator.isTimeoutCurrent(session, query), false)
    assert.equal(coordinator.snapshot(session).timeoutActive, false)
})
