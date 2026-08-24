import assert from 'node:assert/strict'
import test from 'node:test'
import {createTaskCoordinator, createTaskSnapshot, transitionTask} from './task-coordinator.mjs'
import {createTaskPlan} from './task-plan.mjs'

function plan() {
    return createTaskPlan({taskId: 't1', turnId: 'turn1', sessionId: 's1', phases: ['implement', 'validate', 'report'], reviewRequired: false, createdAt: 1})
}

test('接受、规划、运行、验证、暂停、阻塞和恢复由单一 revision 聚合', () => {
    const coordinator = createTaskCoordinator({now: () => 10})
    assert.equal(coordinator.accept(plan()).status, 'accepted')
    let state = coordinator.transition('t1', {type: 'phase/started', phase: 'implement', stepId: 't1:step:1'})
    assert.equal(state.status, 'running')
    state = coordinator.transition('t1', {type: 'task/waiting-user', detail: '需要确认'})
    assert.equal(state.status, 'waiting_user')
    state = coordinator.transition('t1', {type: 'task/resumed'})
    assert.equal(state.status, 'running')
    state = coordinator.transition('t1', {type: 'task/blocked', code: 'external'})
    assert.equal(state.status, 'blocked')
})

test('暂停是可恢复终态，明确恢复后重新进入活动状态', () => {
    const coordinator = createTaskCoordinator({now: () => 10})
    coordinator.accept(plan())
    const paused = coordinator.transition('t1', {type: 'task/paused', detail: '用户暂停'})
    assert.equal(paused.status, 'paused')
    assert.equal(paused.completedAt, 10)
    assert.equal(coordinator.isActive('t1'), false)
    const resumed = coordinator.transition('t1', {type: 'task/resumed'})
    assert.equal(resumed.status, 'running')
    assert.equal(resumed.completedAt, 0)
    assert.equal(coordinator.isActive('t1'), true)
})

test('重复和迟到 revision 被忽略', () => {
    const initial = createTaskSnapshot({plan: plan(), now: 1})
    const first = transitionTask(initial, {type: 'task/status', status: 'running', revision: 2})
    assert.equal(first.revision, 2)
    assert.equal(transitionTask(first, {type: 'task/status', status: 'failed', revision: 2}).status, 'running')
    assert.equal(transitionTask(first, {type: 'task/status', status: 'failed', revision: 4}).status, 'running')
})

test('活动 Agent 或 Workflow 以及证据不足时不能完成', () => {
    const coordinator = createTaskCoordinator({now: () => 1})
    coordinator.accept(plan())
    coordinator.transition('t1', {type: 'phase/completed', stepId: 't1:step:1'})
    coordinator.transition('t1', {type: 'phase/completed', stepId: 't1:step:2'})
    coordinator.transition('t1', {type: 'phase/completed', stepId: 't1:step:3'})
    coordinator.transition('t1', {type: 'agent/started', agentRunId: 'a1'})
    coordinator.transition('t1', {type: 'verification/result', status: 'passed', evidenceLevel: 'L2', testsExecuted: true})
    let state = coordinator.transition('t1', {type: 'task/complete-requested'})
    assert.equal(state.status, 'inconclusive')

    const fresh = createTaskCoordinator({now: () => 1})
    fresh.accept(plan())
    fresh.transition('t1', {type: 'phase/completed', stepId: 't1:step:1'})
    fresh.transition('t1', {type: 'phase/completed', stepId: 't1:step:2'})
    fresh.transition('t1', {type: 'phase/completed', stepId: 't1:step:3'})
    fresh.transition('t1', {type: 'verification/result', status: 'passed', evidenceLevel: 'L2', testsExecuted: true})
    assert.equal(fresh.transition('t1', {type: 'task/complete-requested'}).status, 'inconclusive')

    const ready = createTaskCoordinator({now: () => 1})
    ready.accept(plan())
    ready.transition('t1', {type: 'phase/completed', stepId: 't1:step:1'})
    ready.transition('t1', {type: 'phase/completed', stepId: 't1:step:2'})
    ready.transition('t1', {type: 'phase/completed', stepId: 't1:step:3'})
    ready.transition('t1', {type: 'agent/started', agentRunId: 'primary', stepId: 't1:step:1', role: 'developer'})
    ready.transition('t1', {type: 'agent/completed', agentRunId: 'primary', stepId: 't1:step:1', role: 'developer', result: {status: 'completed'}})
    ready.transition('t1', {type: 'verification/result', status: 'passed', evidenceLevel: 'L2', testsExecuted: true})
    ready.transition('t1', {type: 'notification/intent-persisted', persisted: true})
    state = ready.transition('t1', {type: 'task/complete-requested'})
    assert.equal(state.status, 'completed')
})

test('要求 Agent 的步骤没有结构化结果时不能完成', () => {
    const coordinator = createTaskCoordinator()
    const plan = createTaskPlan({taskId: 'agent-gate', turnId: 't', sessionId: 's', workDir: 'D:\\work', phases: ['implement', 'report']})
    coordinator.accept(plan)
    let snapshot = coordinator.dispatchTask(plan.taskId)
    snapshot = coordinator.transition(plan.taskId, {type: 'phase/completed', stepId: plan.steps[0].stepId, phase: 'implement'})
    snapshot = coordinator.dispatchTask(plan.taskId)
    snapshot = coordinator.transition(plan.taskId, {type: 'phase/completed', stepId: plan.steps[1].stepId, phase: 'report'})
    snapshot = coordinator.transition(plan.taskId, {type: 'notification/intent-persisted', persisted: true})
    snapshot = coordinator.transition(plan.taskId, {type: 'task/complete-requested'})
    assert.equal(snapshot.status, 'inconclusive')
    assert.match(snapshot.blockers.at(-1).detail, /agent_result_missing/)
})

test('环境阻塞、新回归和未验证保持非完成终态', () => {
    for (const [verification, expected] of [['blocked_environment', 'blocked'], ['regression_detected', 'regression_detected'], ['inconclusive', 'inconclusive']]) {
        const coordinator = createTaskCoordinator({now: () => 1})
        coordinator.accept(plan())
        coordinator.transition('t1', {type: 'verification/result', status: verification})
        assert.equal(coordinator.transition('t1', {type: 'task/complete-requested'}).status, expected)
    }
})

test('终态后只允许附加执行报告，迟到状态事件不能改写终态', () => {
    const coordinator = createTaskCoordinator()
    const taskPlan = createTaskPlan({taskId: 'report-terminal', turnId: 't', sessionId: 's', workDir: 'D:\\work', phases: ['report']})
    coordinator.accept(taskPlan)
    let snapshot = coordinator.dispatchTask(taskPlan.taskId)
    snapshot = coordinator.transition(taskPlan.taskId, {
        type: 'agent/started', stepId: taskPlan.steps[0].stepId,
        agentRunId: `${taskPlan.taskId}:primary`, role: 'developer',
    })
    snapshot = coordinator.transition(taskPlan.taskId, {
        type: 'agent/completed', stepId: taskPlan.steps[0].stepId,
        agentRunId: `${taskPlan.taskId}:primary`, role: 'developer', result: {status: 'completed'},
    })
    snapshot = coordinator.transition(taskPlan.taskId, {type: 'phase/completed', stepId: taskPlan.steps[0].stepId, phase: 'report'})
    snapshot = coordinator.transition(taskPlan.taskId, {type: 'notification/intent-persisted', persisted: true})
    snapshot = coordinator.transition(taskPlan.taskId, {type: 'task/complete-requested'})
    assert.equal(snapshot.status, 'completed')
    const withReport = coordinator.transition(taskPlan.taskId, {type: 'report/generated', report: {taskId: taskPlan.taskId, status: 'completed'}})
    assert.equal(withReport.executionReport.status, 'completed')
    assert.equal(coordinator.transition(taskPlan.taskId, {type: 'task/status', status: 'failed'}).status, 'completed')
})

test('Agent 投影包含身份、目的、结果计数和有界时间线，不持久化正文', () => {
    const coordinator = createTaskCoordinator({now: () => 10})
    coordinator.accept(plan())
    let state = coordinator.transition('t1', {
        type: 'agent/started', agentRunId: 'agent-1', agentType: 'test-engineer', name: '验证 Agent',
        role: 'test-engineer', stepId: 't1:step:1', purpose: '执行最小充分测试', goal: '确认回归风险', at: 11,
    })
    assert.equal(state.agents['agent-1'].name, '验证 Agent')
    assert.equal(state.agents['agent-1'].purpose, '执行最小充分测试')
    state = coordinator.transition('t1', {
        type: 'agent/completed', agentRunId: 'agent-1', agentType: 'test-engineer', name: '验证 Agent',
        role: 'test-engineer', stepId: 't1:step:1', result: {
            status: 'completed', summary: '测试通过', changedFiles: ['a.mjs', 'b.mjs'], tests: [{name: 'node --test'}],
            prompt: '不得保存这段正文',
        }, at: 12,
    })
    assert.equal(state.agents['agent-1'].resultSummary, '测试通过')
    assert.equal(state.agents['agent-1'].changedFileCount, 2)
    assert.equal(state.agents['agent-1'].testCount, 1)
    assert.equal(state.agents['agent-1'].endedAt, 12)
    assert.equal(state.timeline.length, 2)
    assert.equal(state.timeline.at(-1).summary, '测试通过')
})

test('Agent 时间线最多保留最近 40 条', () => {
    const coordinator = createTaskCoordinator({now: () => 1})
    coordinator.accept(plan())
    for (let index = 0; index < 25; index += 1) {
        const id = `agent-${index}`
        coordinator.transition('t1', {type: 'agent/started', agentRunId: id, role: 'developer', at: index + 2})
        coordinator.transition('t1', {type: 'agent/completed', agentRunId: id, role: 'developer', result: {status: 'completed', summary: `完成 ${index}`}, at: index + 3})
    }
    const state = coordinator.getTaskSnapshot('t1')
    assert.equal(state.timeline.length, 40)
    assert.equal(state.timeline[0].agentRunId, 'agent-5')
})

test('Workflow 调度遵守步骤依赖并在快照中记录执行预算', () => {
    const coordinator = createTaskCoordinator()
    const planValue = plan()
    planValue.executionMode = 'workflow'
    planValue.continuationPolicy = {maxRounds: 4, maxTokens: 8000}
    coordinator.accept(planValue)
    let snapshot = coordinator.dispatchTask(planValue.taskId)
    assert.equal(snapshot.execution.mode, 'workflow')
    assert.equal(snapshot.execution.currentStepId, planValue.steps[0].stepId)
    snapshot = coordinator.transition(planValue.taskId, {type: 'phase/completed', stepId: planValue.steps[0].stepId, phase: planValue.steps[0].phase})
    snapshot = coordinator.dispatchTask(planValue.taskId)
    assert.equal(snapshot.execution.currentStepId, planValue.steps[1].stepId)
    assert.equal(snapshot.execution.completedStepCount, 1)
})

test('计划推进 API 拒绝跳步，并在阻塞恢复后从原步骤继续', () => {
    const coordinator = createTaskCoordinator()
    const taskPlan = createTaskPlan({taskId: 'strict-plan', turnId: 't', sessionId: 's', phases: ['implement', 'validate', 'report']})
    coordinator.accept(taskPlan)
    const started = coordinator.startPlannedTask({taskId: taskPlan.taskId})
    assert.equal(started.execution.currentStepId, taskPlan.steps[0].stepId)
    assert.equal(coordinator.transition(taskPlan.taskId, {type: 'phase/started', phase: 'validate', stepId: taskPlan.steps[1].stepId}).execution.currentStepId, taskPlan.steps[0].stepId)
    const blocked = coordinator.advancePlannedTask({taskId: taskPlan.taskId, stepId: taskPlan.steps[0].stepId, result: {status: 'blocked', code: 'needs_event'}})
    assert.equal(blocked.status, 'blocked')
    assert.equal(blocked.nextStepId, taskPlan.steps[0].stepId)
    const resumed = coordinator.resumePlannedTask({taskId: taskPlan.taskId})
    assert.equal(resumed.status, 'running')
    const advanced = coordinator.advancePlannedTask({taskId: taskPlan.taskId, stepId: taskPlan.steps[0].stepId, result: {status: 'completed', summary: '完成'}})
    assert.equal(advanced.nextStepId, taskPlan.steps[1].stepId)
})
