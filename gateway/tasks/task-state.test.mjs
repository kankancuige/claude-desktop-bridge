import test from 'node:test'
import assert from 'node:assert/strict'
import {createTaskStatePatch, recoverTaskState, isTaskResumable, taskStateForClient, taskStateForInconclusive, taskStateFromResult, taskStateForStop, taskStateFileId, redactTaskDetail} from './task-state.mjs'

test('success is terminal and never resumable', () => {
    const state = createTaskStatePatch({status: 'succeeded', outcome: 'succeeded', resumable: true, numTurns: 3})
    assert.equal(state.outcome, 'succeeded')
    assert.equal(state.resumable, false)
    assert.equal(isTaskResumable(state), false)
})

test('reviewing and changes_required remain resumable intermediate states', () => {
    const reviewing = createTaskStatePatch({status: 'reviewing', resumable: false, review: {round: 1, tier: 'power', summary: '审查中'}})
    assert.equal(reviewing.version, 6)
    assert.equal(reviewing.status, 'reviewing')
    assert.equal(reviewing.outcome, null)
    assert.equal(reviewing.resumable, true)
    assert.equal(reviewing.review.round, 1)

    const changes = recoverTaskState({status: 'changes_required', resumable: true, review: {round: 1, tier: 'power', blockingFindings: [{severity: 'high', title: '问题'}]}})
    assert.equal(changes.status, 'changes_required')
    assert.equal(changes.outcome, null)
    assert.equal(changes.review.blockingCount, 1)
})

test('running state becomes an interrupted resumable task after gateway restart', () => {
    const state = recoverTaskState({status: 'running', sdkSessionId: 'sdk-1', resumable: true}, {now: 123})
    assert.deepEqual(state, {
        version: 6,
        status: 'interrupted',
        outcome: 'failed',
        continuationReason: 'execution_error',
        resumable: true,
        permissionMode: 'default',
        model: null,
        subtype: null,
        sdkSessionId: 'sdk-1',
        historySessionId: null,
        taskId: null,
        turnId: null,
        sequence: 0,
        numTurns: 0,
        startedAt: 0,
        completedAt: 0,
        durationMs: 0,
        detail: '',
        finalReplyText: '',
        finalReplyAvailable: false,
        notifications: {},
        review: {round: 0, tier: null, summary: '', blockingCount: 0, blockingFindings: []},
        updatedAt: 123,
    })
})

test('detail is bounded and client projection excludes session identity', () => {
    const state = createTaskStatePatch({status: 'failed', detail: 'x'.repeat(5000), sdkSessionId: 'secret-sdk'})
    const client = taskStateForClient(state)
    assert.equal(client.detail.length, 2000)
    assert.equal('sdkSessionId' in client, false)
    assert.equal(client.permissionMode, 'default')
    assert.deepEqual(client.review, {round: 0, tier: null, summary: '', blockingCount: 0, blockingFindings: []})
})

test('final reply is persisted with a bounded redacted client projection', () => {
    const state = createTaskStatePatch({
        status: 'succeeded',
        finalReplyText: `${'x'.repeat(13_000)} Authorization: Bearer abc.def-123`,
    })
    assert.equal(state.finalReplyAvailable, true)
    assert.equal(state.finalReplyText.length, 12_000)
    assert.equal(state.finalReplyText.includes('abc.def-123'), false)
    const client = taskStateForClient(state)
    assert.equal(client.finalReplyAvailable, true)
    assert.equal(client.finalReplyText, state.finalReplyText)
})

test('notification projection keeps only supported platforms and safe delivery state', () => {
    const state = createTaskStatePatch({
        status: 'succeeded',
        notifications: {
            wechat: {state: 'failed', notificationId: 'task-1:completed', lastError: 'API_KEY=secret-value', updatedAt: 123},
            unsupported: {state: 'sent'},
        },
    })
    assert.deepEqual(taskStateForClient(state).notifications, {
        wechat: {
            state: 'failed', notificationId: 'task-1:completed', lastError: 'API_KEY=[REDACTED]', updatedAt: 123,
        },
    })
})

test('incomplete result remains resumable', () => {
    const state = createTaskStatePatch({status: 'incomplete', outcome: 'incomplete', continuationReason: 'max_turns'})
    assert.equal(state.resumable, true)
    assert.equal(isTaskResumable(state), true)
})

test('验证不足终态保留既有投影并强制为可继续的 incomplete', () => {
    const state = taskStateForInconclusive(createTaskStatePatch({
        status: 'reviewing', taskId: 'task-1', turnId: 'turn-1', startedAt: 100,
        notifications: {wechat: {state: 'pending', notificationId: 'task-1:task_verification_inconclusive'}},
    }), {detail: '只完成构建，未执行测试', completedAt: 500})
    assert.equal(state.status, 'incomplete')
    assert.equal(state.outcome, 'incomplete')
    assert.equal(state.resumable, true)
    assert.equal(state.detail, '只完成构建，未执行测试')
    assert.equal(state.durationMs, 400)
    assert.equal(state.notifications.wechat.notificationId, 'task-1:task_verification_inconclusive')
})

test('result and stop helpers keep the SDK identity for resume', () => {
    const result = taskStateFromResult({subtype: 'error_max_turns', outcome: 'incomplete', continuationReason: 'max_turns', resumable: true, numTurns: 4}, {sdkSessionId: 'sdk-2'})
    assert.equal(result.status, 'incomplete')
    assert.equal(result.historySessionId, 'sdk-2')
    const stopped = taskStateForStop({sdkSessionId: 'sdk-2'})
    assert.equal(stopped.status, 'stopped')
    assert.equal(stopped.resumable, true)
})

test('task-state persistence prefers the Gateway runtime identity', () => {
    assert.equal(taskStateFileId('gateway-1', 'sdk-1'), 'gateway-1')
    assert.equal(taskStateFileId('', 'sdk-1'), 'sdk-1')
    assert.equal(taskStateFileId('', ''), null)
})

test('persisted task detail redacts common credential forms', () => {
    const detail = redactTaskDetail('Authorization: Bearer abc.def-123 API_KEY=secret-value sk-live_123456789 https://user:pass@example.com')
    assert.equal(detail.includes('abc.def-123'), false)
    assert.equal(detail.includes('secret-value'), false)
    assert.equal(detail.includes('sk-live_123456789'), false)
    assert.equal(detail.includes('user:pass'), false)
    assert.match(detail, /\[REDACTED\]/)
})

test('父任务身份和事件序号可跨重启持久化', () => {
    const state = createTaskStatePatch({
        status: 'reviewing', taskId: 'gw-1:turn-2', turnId: 'turn-2', sequence: 4,
    })
    const restored = recoverTaskState(state)
    assert.equal(restored.taskId, 'gw-1:turn-2')
    assert.equal(restored.turnId, 'turn-2')
    assert.equal(taskStateForClient(restored).sequence, 4)
})

test('实际路由模型跨重启保留并投影给客户端', () => {
    const restored = recoverTaskState(createTaskStatePatch({
        status: 'succeeded', model: 'model-a', taskId: 'gw-1:turn-2',
    }))
    assert.equal(restored.model, 'model-a')
    assert.equal(taskStateForClient(restored).model, 'model-a')
})

test('任务起止时间和总耗时可持久化并投影给客户端', () => {
    const state = createTaskStatePatch({status: 'succeeded', startedAt: 1000, completedAt: 4600, durationMs: 3600})
    const client = taskStateForClient(state)
    assert.equal(client.startedAt, 1000)
    assert.equal(client.completedAt, 4600)
    assert.equal(client.durationMs, 3600)
})

console.log('task-state tests passed')
