import assert from 'node:assert/strict'
import test from 'node:test'
import {createTaskCoordinator} from './task-coordinator.mjs'
import {createTaskPlan} from './task-plan.mjs'
import {createTaskWorkbenchRuntime} from './task-workbench-runtime.mjs'

function plan(phases = ['prime', 'plan', 'implement', 'validate', 'review', 'report']) {
    return createTaskPlan({
        taskId: 'task-1', turnId: 'turn-1', sessionId: 'session-1', source: 'desktop',
        goal: '修改并验证', workDir: 'D:\\work', phases, reviewRequired: phases.includes('review'),
    })
}

test('任务接受后真实结算 Prime 和 Plan，并由主 Agent 接管工作阶段', () => {
    const coordinator = createTaskCoordinator()
    const runtime = createTaskWorkbenchRuntime({coordinator})
    const accepted = runtime.acceptTask({plan: plan(), projectContext: {projectKey: 'D--work'}})

    assert.equal(accepted.snapshot.phase, 'implement')
    assert.deepEqual(accepted.snapshot.plan.steps.map(step => step.status), [
        'completed', 'completed', 'running', 'pending', 'pending', 'pending',
    ])
    assert.equal(Object.values(accepted.snapshot.agents)[0].status, 'running')
})

test('主 Agent、验证、审查、报告和通知意图按顺序通过唯一完成门禁', () => {
    const reports = []
    const coordinator = createTaskCoordinator()
    const runtime = createTaskWorkbenchRuntime({coordinator, persistReport: report => reports.push(report)})
    runtime.acceptTask({plan: plan(), projectContext: {projectKey: 'D--work'}})

    let snapshot = runtime.recordPrimaryResult('task-1', {
        status: 'completed', summary: '实现完成', changedFiles: ['gateway/a.mjs'],
        tests: [{name: 'unit', status: 'passed', executed: true, evidence: '1/1'}],
    })
    assert.equal(snapshot.phase, 'validate')

    snapshot = runtime.recordVerification('task-1', {
        status: 'passed', evidenceLevel: 'L2', testsExecuted: true, summary: '验证通过',
    })
    assert.equal(snapshot.phase, 'review')

    snapshot = runtime.recordReviewResult('task-1', {passed: true, summary: '审查通过', findings: []})
    assert.equal(snapshot.phase, 'report')

    const rejected = runtime.requestCompletion('task-1', {notificationIntentPersisted: false})
    assert.equal(rejected.status, 'inconclusive')
    assert.equal(reports.length, 1)
})

test('无审查任务在通知意图持久化后完成，并生成可查询执行报告', () => {
    const coordinator = createTaskCoordinator()
    const runtime = createTaskWorkbenchRuntime({coordinator})
    runtime.acceptTask({plan: plan(['implement', 'validate', 'report']), projectContext: {projectKey: 'D--work'}})
    runtime.recordPrimaryResult('task-1', {status: 'completed', summary: '完成'})
    runtime.recordVerification('task-1', {status: 'passed', evidenceLevel: 'L2', testsExecuted: true})
    const completed = runtime.requestCompletion('task-1', {notificationIntentPersisted: true})

    assert.equal(completed.status, 'completed')
    assert.equal(runtime.getExecutionReport('task-1').status, 'completed')
    assert.ok(runtime.getExecutionReport('task-1').completedAt > 0)
    assert.equal(runtime.getExecutionReport('task-1').verification.evidenceLevel, 'L2')
})

test('失败进入 Repair Loop 并记录 Pitfall occurrence', () => {
    const occurrences = []
    const coordinator = createTaskCoordinator()
    const runtime = createTaskWorkbenchRuntime({
        coordinator,
        pitfallService: {
            findRelevantPitfalls: () => [],
            recordPitfallOccurrence: input => { occurrences.push(input); return {id: 'pitfall-1', status: 'observed'} },
        },
    })
    runtime.acceptTask({plan: plan(['implement', 'validate', 'report']), projectContext: {projectKey: 'D--work'}})
    const outcome = runtime.recordFailure('task-1', {
        module: 'gateway', phase: 'implement', errorCode: 'E_TEST', message: 'boom', strategy: 'first-fix',
    })

    assert.equal(outcome.repair.action, 'retry')
    assert.equal(occurrences.length, 1)
    assert.equal(occurrences[0].taskId, 'task-1')
})

test('同策略重复失败经 RCA 新根因与新策略后才允许第三次修复', () => {
    const coordinator = createTaskCoordinator()
    const runtime = createTaskWorkbenchRuntime({coordinator})
    runtime.acceptTask({plan: plan(['implement', 'validate', 'report']), projectContext: {projectKey: 'D--work'}})
    runtime.recordFailure('task-1', {errorCode: 'E', strategy: 'same', message: 'boom'})
    const repeated = runtime.recordFailure('task-1', {errorCode: 'E', strategy: 'same', message: 'boom'})
    assert.equal(repeated.repair.action, 'rca')
    assert.notEqual(runtime.getTaskSnapshot('task-1').status, 'diagnosis_required')
    const rca = runtime.recordRcaResult('task-1', {newRootCause: true, newStrategy: true, nextStrategy: '修复共享生命周期'})
    assert.equal(rca.action, 'retry')
    assert.equal(rca.snapshot.rootCauseAnalysis.nextStrategy, '修复共享生命周期')
})

test('失败或阻塞终态也生成与终态一致的执行报告', () => {
    const reports = []
    const coordinator = createTaskCoordinator()
    const runtime = createTaskWorkbenchRuntime({coordinator, persistReport: report => reports.push(report)})
    runtime.acceptTask({plan: plan(['implement', 'validate', 'report']), projectContext: {projectKey: 'D--work'}})
    runtime.recordTaskEvent('task-1', {type: 'task/blocked', code: 'environment', detail: '缺少运行环境'})
    const snapshot = runtime.finalizeReport('task-1', {unresolvedRisks: ['真实环境未验证']})
    assert.equal(snapshot.status, 'blocked')
    assert.equal(reports[0].status, 'blocked')
    assert.ok(reports[0].unresolvedRisks.includes('真实环境未验证'))
})

test('所有稳定非成功终态都生成状态一致的执行报告', () => {
    const statuses = [
        'failed', 'paused', 'blocked', 'inconclusive', 'regression_detected',
        'diagnosis_required', 'awaiting_reproduction', 'blocked_external', 'architecture_change_required',
    ]
    for (const status of statuses) {
        const coordinator = createTaskCoordinator()
        const runtime = createTaskWorkbenchRuntime({coordinator})
        runtime.acceptTask({plan: plan(['implement', 'report']), projectContext: {projectKey: 'D--work'}})
        runtime.recordTaskEvent('task-1', {type: 'task/status', status})
        const snapshot = runtime.finalizeReport('task-1', {unresolvedRisks: [`${status} 尚未关闭`]})
        assert.equal(snapshot.status, status)
        assert.equal(snapshot.executionReport.status, status)
        assert.ok(snapshot.executionReport.completedAt > 0)
        assert.ok(snapshot.executionReport.unresolvedRisks.includes(`${status} 尚未关闭`))
    }
})
