import test from 'node:test'
import assert from 'node:assert/strict'
import {createScheduledRuntime} from './scheduled-runtime.mjs'

test('Scheduled Runtime 提供独立的调度状态和恢复边界', () => {
    const runtime = createScheduledRuntime({
        cron: {schedule() { return {stop() {}} }},
        scheduledTaskStore: {get() { return null }, list() { return {} }},
        sessions: new Map(),
        cronJobs: new Map(),
        scheduledRuns: new Map(),
        MAX_SCHEDULED_CONCURRENT: 2,
        MAX_SCHEDULED_DURATION_MS: 60_000,
        finishScheduledRun() {},
    })
    assert.equal(typeof runtime.registerScheduledJob, 'function')
    assert.equal(typeof runtime.executeScheduledTask, 'function')
    assert.equal(typeof runtime.resumeScheduledTasks, 'function')
})

test('Scheduled Runtime 缺少边界依赖时立即失败', () => {
    assert.throws(() => createScheduledRuntime({}), /scheduled runtime dependencies are required/)
})
