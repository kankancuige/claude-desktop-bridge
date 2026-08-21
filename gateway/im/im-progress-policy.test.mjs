import assert from 'node:assert/strict'
import test from 'node:test'
import {createImProgressPolicy} from './im-progress-policy.mjs'

test('短任务不发中间进度，非 Coordinator 工具事件永不进入 IM', () => {
    const policy = createImProgressPolicy()
    assert.equal(policy.evaluate({type: 'tool_use_start'}, 40_000).send, false)
    assert.equal(policy.evaluate({type: 'task_coordinator_event', taskId: 't', event: 'phase/started', phase: 'implement', timestamp: 1}, 20_000).send, false)
})

test('长任务只发关键阶段并遵守冷却和数量上限', () => {
    const policy = createImProgressPolicy({longTaskThresholdMs: 10, cooldownMs: 20, maxMessages: 2})
    assert.equal(policy.evaluate({type: 'task_coordinator_event', taskId: 't', event: 'phase/started', phase: 'implement', timestamp: 1}, 20).send, true)
    assert.equal(policy.evaluate({type: 'task_coordinator_event', taskId: 't', event: 'phase/completed', phase: 'implement'}, 25).send, false)
    assert.equal(policy.evaluate({type: 'task_coordinator_event', taskId: 't', event: 'phase/started', phase: 'validate'}, 50).send, true)
    assert.equal(policy.evaluate({type: 'task_coordinator_event', taskId: 't', event: 'phase/started', phase: 'review'}, 100).send, false)
})

test('终态由通知 outbox 唯一发送最终总结', () => {
    const policy = createImProgressPolicy()
    const event = {type: 'task_coordinator_event', taskId: 't', status: 'failed', event: 'phase/failed'}
    assert.deepEqual(policy.evaluate(event), {send: false, terminal: true, reason: 'final_summary_owned_by_outbox'})
    assert.equal(policy.evaluate(event).reason, 'terminal_duplicate')
})

test('RCA 和外部阻塞终态也只交给最终通知 outbox', () => {
    for (const status of ['diagnosis_required', 'awaiting_reproduction', 'blocked_external', 'architecture_change_required']) {
        const policy = createImProgressPolicy()
        assert.equal(policy.evaluate({type: 'task_coordinator_event', taskId: `t-${status}`, status, event: 'rca/completed'}).terminal, true)
    }
})
