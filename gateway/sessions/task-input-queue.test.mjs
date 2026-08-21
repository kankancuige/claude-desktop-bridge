import assert from 'node:assert/strict'
import test from 'node:test'
import {createTaskInputQueue} from './task-input-queue.mjs'

function session(overrides = {}) {
    return {_pendingInputs: [], _inputIds: new Map(), activeTurnId: null, ...overrides}
}

test('接受输入时按来源、用户和 messageId 去重，并在上限处拒绝', () => {
    const queue = createTaskInputQueue({maxPending: 2, imSources: new Set(['wechat'])})
    const target = session()
    const first = queue.accept(target, {source: 'wechat', userId: 'u-1', messageId: 'm-1'})
    assert.equal(first.ok, true)
    assert.equal(first.queuePosition, 0)
    assert.equal(target._pendingInputs[0].userId, 'u-1')
    assert.deepEqual(queue.accept(target, {source: 'wechat', userId: 'u-1', messageId: 'm-1'}), {
        ok: false, duplicate: true, messageId: 'm-1',
    })

    target._pendingInputs.shift()
    target.activeTurnId = 'active-turn'
    assert.equal(queue.accept(target, {source: 'desktop', messageId: 'm-2'}).ok, true)
    assert.deepEqual(queue.accept(target, {source: 'desktop', messageId: 'm-3'}), {
        ok: false, error: 'input_queue_full', queuePosition: 2,
    })
})

test('回滚和 drain 同时移除待处理项及去重键', () => {
    const queue = createTaskInputQueue({maxPending: 3, createId: () => 'generated-message'})
    const target = session()
    const accepted = queue.accept(target, {source: 'desktop'})
    assert.equal(accepted.messageId, 'generated-message')
    assert.equal(queue.rollback(target, accepted), true)
    assert.equal(target._pendingInputs.length, 0)
    assert.equal(target._inputIds.size, 0)

    queue.accept(target, {source: 'desktop', messageId: 'first'})
    queue.accept(target, {source: 'desktop', messageId: 'second'})
    const pending = queue.drain(target)
    assert.deepEqual(pending.map(item => item.messageId), ['first', 'second'])
    assert.equal(target._pendingInputs.length, 0)
    assert.equal(target._inputIds.size, 0)
})

test('内部输入位于队首且不伪造外部 messageId', () => {
    const queue = createTaskInputQueue({maxPending: 3})
    const target = session()
    queue.accept(target, {source: 'desktop', messageId: 'external'})
    queue.prependInternal(target, {source: 'desktop', taskDecision: {complexity: 'balanced'}})
    assert.deepEqual(target._pendingInputs.map(item => item.messageId), [null, 'external'])
    assert.equal(target._pendingInputs[0].taskDecision.complexity, 'balanced')
})

test('消费只移除队首，空闲确认不会误消费正在执行后的补充输入', () => {
    const queue = createTaskInputQueue({maxPending: 3})
    const target = session()
    queue.accept(target, {source: 'desktop', messageId: 'first'})
    queue.accept(target, {source: 'desktop', messageId: 'second'})
    target.activeTurnId = 'first-turn'
    assert.equal(queue.consume(target, {onlyWhenIdle: true}), null)
    target.activeTurnId = null
    assert.equal(queue.consume(target, {onlyWhenIdle: true}).messageId, 'first')
    assert.deepEqual(target._pendingInputs.map(item => item.messageId), ['second'])
})
