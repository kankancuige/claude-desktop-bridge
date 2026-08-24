import assert from 'node:assert/strict'
import test from 'node:test'
import {runBoundedPlanContextSmoke} from './bounded-plan-context-smoke.mjs'

test('有界计划 Smoke 覆盖五步执行、阻塞恢复、预算和上下文裁剪', () => {
    const report = runBoundedPlanContextSmoke()
    assert.equal(report.stepStatuses.every(status => status === 'completed'), true)
    assert.equal(report.blockedStatus, 'blocked')
    assert.equal(report.resumedStatus, 'completed')
    assert.ok(report.contextLayers.includes('l0'))
    assert.ok(report.omitted.some(item => item.layer === 'l2'))
    assert.equal(report.estimatedUsage.actualTokens, null)
})
