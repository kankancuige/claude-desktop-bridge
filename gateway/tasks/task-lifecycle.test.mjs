import test from 'node:test'
import assert from 'node:assert/strict'

import {createTaskLifecycleSnapshot, getCurrentSessionWorkflow, sortSessionWorkflows} from './task-lifecycle.mjs'

test('当前 Workflow 优先选择运行项，再按开始时间选择最新项', () => {
    const workflows = [
        {wfId: 'old-done', status: 'done', startedAt: 300},
        {wfId: 'old-running', status: 'running', startedAt: 100},
        {wfId: 'new-running', status: 'running', startedAt: 200},
    ]
    assert.equal(getCurrentSessionWorkflow(workflows)?.wfId, 'new-running')
    assert.deepEqual(sortSessionWorkflows(workflows).map(item => item.wfId), ['new-running', 'old-running', 'old-done'])
})

test('父任务、runtime 或任一 Workflow 活跃时统一禁止新任务并允许停止', () => {
    const fromTask = createTaskLifecycleSnapshot({task: {status: 'reviewing'}})
    assert.equal(fromTask.active, true)
    assert.deepEqual(fromTask.capabilities, {canSend: false, canStop: true, canContinue: false})

    const fromRuntime = createTaskLifecycleSnapshot({runtime: {generating: true}, task: {status: 'idle'}})
    assert.equal(fromRuntime.active, true)

    const fromTaskWorkflowGate = createTaskLifecycleSnapshot({runtime: {taskWorkflowPending: true}, task: {status: 'succeeded'}})
    assert.equal(fromTaskWorkflowGate.active, true)
    assert.equal(fromTaskWorkflowGate.runtime.generating, false)
    assert.equal(fromTaskWorkflowGate.runtime.taskWorkflowPending, true)

    const fromWorkflow = createTaskLifecycleSnapshot({
        task: {status: 'succeeded'},
        workflows: [{wfId: 'review', status: 'running', startedAt: 1}],
    })
    assert.equal(fromWorkflow.active, true)
})

test('终态只有在全部子执行结束后才允许发送或继续', () => {
    const snapshot = createTaskLifecycleSnapshot({
        sessionId: 'session-1',
        runtime: {running: true, generating: false, pendingInputs: 0},
        task: {status: 'interrupted', resumable: true, sequence: 7},
        workflows: [{wfId: 'done', status: 'done', startedAt: 5}],
    })
    assert.equal(snapshot.active, false)
    assert.equal(snapshot.runtime.ready, true)
    assert.equal(snapshot.sequence, 7)
    assert.deepEqual(snapshot.capabilities, {canSend: true, canStop: false, canContinue: true})
})

test('父任务已进入成功终态时忽略 SDK 清理残留的 generating 标志', () => {
    const snapshot = createTaskLifecycleSnapshot({
        runtime: {generating: true, taskWorkflowPending: false},
        task: {status: 'succeeded', resumable: false, sequence: 8},
        workflows: [{wfId: 'done', status: 'done', startedAt: 5}],
    })
    assert.equal(snapshot.active, false)
    assert.deepEqual(snapshot.capabilities, {canSend: true, canStop: false, canContinue: false})
})

test('成功结果投影暂时显示 idle 时仍忽略清理残留', () => {
    const snapshot = createTaskLifecycleSnapshot({
        runtime: {generating: true},
        task: {status: 'idle', outcome: 'succeeded', completedAt: 1234},
    })
    assert.equal(snapshot.active, false)
    assert.equal(snapshot.capabilities.canSend, true)
})

test('waiting_user Coordinator 在重连快照中解除输入锁并保留提示', () => {
    const snapshot = createTaskLifecycleSnapshot({
        runtime: {generating: true},
        task: {status: 'running', resumable: false},
        coordinator: {
            taskId: 'task-1', turnId: 'turn-1', status: 'waiting_user', phase: 'implement', revision: 4,
            execution: {currentStepId: 'step-1'}, blockers: [{detail: '请选择验证环境\n后继续'}],
            verification: {status: 'not_started', evidenceLevel: 'L0'},
        },
    })
    assert.equal(snapshot.active, false)
    assert.deepEqual(snapshot.capabilities, {canSend: true, canStop: false, canContinue: true})
    assert.deepEqual(snapshot.coordinator, {
        taskId: 'task-1', turnId: 'turn-1', status: 'waiting_user', phase: 'implement', revision: 4,
        stepId: 'step-1', detail: '请选择验证环境 后继续', verification: {status: 'not_started', evidenceLevel: 'L0'},
    })
})
