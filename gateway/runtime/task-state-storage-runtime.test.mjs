import test from 'node:test'
import assert from 'node:assert/strict'
import {createTaskStateStorageRuntime} from './task-state-storage-runtime.mjs'

function makeRuntime(overrides = {}) {
    return createTaskStateStorageRuntime({
        bridgeHome: 'D:/bridge', encodeProjectName: value => value, joinPath: (...parts) => parts.join('/'),
        taskStateFileId: value => value, readJSON: () => null, writeJSON() {}, recoverTaskState: value => value,
        sessionCatalogProjectKey: value => value, getWorkbenchRepository: () => null,
        looksLikeIncompleteTransportFailure: () => false, ...overrides,
    })
}

test('任务状态存储 Runtime 读写文件快照并修复路径', () => {
    const writes = []
    const runtime = makeRuntime({writeJSON: (path, state) => writes.push({path, state})})
    assert.equal(runtime.taskStateStorePath('D:/work', 's1'), 'D:/bridge/projects/D:/work/bridge-task-state/s1.json')
    assert.equal(runtime.saveTaskState({workDir: 'D:/work', taskState: {status: 'running'}}, 's1'), true)
    assert.equal(writes.length, 1)
})

test('任务状态存储 Runtime 合并 PostgreSQL 投影并保持文件正文字段', () => {
    const runtime = makeRuntime({
        readJSON: () => ({detail: 'full reply', finalReplyText: 'reply'}),
        getWorkbenchRepository: () => ({getTask: () => ({state: {status: 'succeeded', taskId: 't1'}})}),
    })
    const state = runtime.loadTaskState('D:/work', 's1')
    assert.equal(state.status, 'succeeded')
    assert.equal(state.detail, 'full reply')
})

test('任务状态存储 Runtime 将疑似断流的 succeeded 纠正为失败', () => {
    const runtime = makeRuntime({looksLikeIncompleteTransportFailure: () => true})
    const state = runtime.repairPersistedTaskState({status: 'succeeded', detail: '断流'})
    assert.equal(state.status, 'failed')
    assert.equal(state.resumable, false)
})

test('任务状态存储 Runtime 缺少端口时立即失败', () => {
    assert.throws(() => createTaskStateStorageRuntime(), /dependencies are required/)
})
