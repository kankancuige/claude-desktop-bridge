import assert from 'node:assert/strict'
import test from 'node:test'
import {classifyRcaOutcome, createRepairLoop} from './repair-loop.mjs'

test('一次失败可重试，同一策略重复立即 RCA', () => {
    const loop = createRepairLoop()
    assert.equal(loop.recordFailure({fingerprint: 'f', strategy: 's1'}).action, 'retry')
    assert.equal(loop.recordFailure({fingerprint: 'f', strategy: 's1'}).status, 'diagnosis_required')
})

test('第三次仅在 RCA 提供新根因和策略后继续', () => {
    const loop = createRepairLoop()
    loop.recordFailure({fingerprint: 'f', strategy: 's1'})
    loop.recordFailure({fingerprint: 'f', strategy: 's2'})
    assert.equal(loop.recordFailure({fingerprint: 'f', strategy: 's3'}).status, 'diagnosis_required')
    assert.equal(loop.recordFailure({fingerprint: 'g', strategy: 's1'}).action, 'retry')
    assert.equal(loop.recordFailure({fingerprint: 'g', strategy: 's2'}).action, 'retry')
    assert.equal(loop.recordFailure({fingerprint: 'g', strategy: 's3', rca: {newRootCause: true, newStrategy: true}}).action, 'retry')
})

test('回归、外部阻塞和无法复现停止叠加补丁', () => {
    const loop = createRepairLoop()
    assert.equal(loop.recordFailure({fingerprint: 'r', strategy: 'x', regression: true}).action, 'freeze')
    assert.equal(loop.recordFailure({fingerprint: 'e', strategy: 'x', externalBlocker: true}).status, 'blocked_external')
    assert.equal(classifyRcaOutcome({reproducible: false}), 'awaiting_reproduction')
})
