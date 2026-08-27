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

test('无人值守定时任务未显式配置时使用 bypassPermissions', async () => {
    let queryBody = null
    class FakePushStream { push() {} close() {} }
    const scheduledRuns = new Map()
    const runtime = createScheduledRuntime({
        cron: {schedule() { return {stop() {}} }},
        scheduledTaskStore: {
            get() { return {enabled: true, prompt: '执行检查', workDir: 'D:/work'} },
            list() { return {} },
        },
        sessions: new Map(), cronJobs: new Map(), scheduledRuns,
        MAX_SCHEDULED_CONCURRENT: 2, MAX_SCHEDULED_DURATION_MS: 60_000,
        log: {info() {}, warn() {}, error() {}}, isDirectoryPath: () => true,
        decideTask: () => ({}), MODEL: 'model', crypto: {randomUUID: () => 'session-1'}, PushStream: FakePushStream,
        loadCliSettings: () => ({}),
        makeQueryOptions: async body => { queryBody = body; return {} },
        openSessionEventJournal: () => ({close() {}}), startClaudeAgent: () => ({}),
        createSessionRuntime: ({query, pushStream, workDir, opts, extra}) => ({query, pushStream, workDir, queryOpts: opts, pending: new Map(), clients: new Set(), ...extra}),
        createTaskCompletionState: value => value, appendSessionEvent() {},
        initializeTaskWorkbenchSession: async () => {}, updateTaskState() {}, taskStateFromCompletion: () => ({}),
        markInternalInput() {}, buildTaskPitfallReminder: () => '', startStreamPump() {},
    })
    await runtime.executeScheduledTask('task-1')
    assert.equal(queryBody.permissionMode, 'bypassPermissions')
    runtime.finishScheduledRun('task-1')
})
