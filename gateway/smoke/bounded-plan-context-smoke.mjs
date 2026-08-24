import {planContext} from '../context/context-planner.mjs'
import {resolveAutoContinuation} from '../tasks/task-auto-continuation.mjs'
import {createTaskPlan} from '../tasks/task-plan.mjs'
import {createTaskCoordinator} from '../tasks/task-coordinator.mjs'

export function runBoundedPlanContextSmoke() {
    const plan = createTaskPlan({
        taskId: 'smoke-task', goal: '验证有界计划执行', workDir: 'smoke-project',
        executionMode: 'workflow', continuationPolicy: {maxPlanSteps: 5, maxRounds: 3, maxTokens: 2000},
        phases: ['prime', 'plan', 'implement', 'validate', 'report'],
        acceptanceCriteria: ['结构化结果', '验证通过'],
    })
    const events = []
    const coordinator = createTaskCoordinator({persist: (snapshot, event) => events.push({snapshot, event})})
    coordinator.accept(plan)
    coordinator.dispatchTask(plan.taskId)
    coordinator.transition(plan.taskId, {type: 'phase/completed', stepId: plan.steps[0].stepId, phase: 'prime', summary: '项目摘要已加载'})
    coordinator.dispatchTask(plan.taskId)
    coordinator.transition(plan.taskId, {type: 'phase/completed', stepId: plan.steps[1].stepId, phase: 'plan', summary: '计划已建立'})
    coordinator.dispatchTask(plan.taskId)
    coordinator.transition(plan.taskId, {type: 'agent/started', stepId: plan.steps[2].stepId, agentRunId: 'smoke-agent', role: 'developer'})
    coordinator.transition(plan.taskId, {type: 'agent/completed', stepId: plan.steps[2].stepId, agentRunId: 'smoke-agent', role: 'developer', result: {summary: '实现完成', changedFiles: ['smoke.mjs'], tests: ['smoke']}})
    coordinator.transition(plan.taskId, {type: 'phase/completed', stepId: plan.steps[2].stepId, phase: 'implement', summary: '实现完成'})
    coordinator.transition(plan.taskId, {type: 'task/blocked', code: 'blocked_environment', detail: '第一次验证等待环境'})
    const blocked = coordinator.getTaskSnapshot(plan.taskId)
    coordinator.transition(plan.taskId, {type: 'task/resumed', status: 'running'})
    coordinator.dispatchTask(plan.taskId)
    coordinator.transition(plan.taskId, {type: 'verification/result', status: 'passed', evidenceLevel: 'L1', testsExecuted: true, summary: 'Smoke 验证通过'})
    coordinator.transition(plan.taskId, {type: 'phase/completed', stepId: plan.steps[3].stepId, phase: 'validate', summary: '验证通过'})
    coordinator.dispatchTask(plan.taskId)
    coordinator.transition(plan.taskId, {type: 'phase/completed', stepId: plan.steps[4].stepId, phase: 'report', summary: '报告完成'})
    coordinator.transition(plan.taskId, {type: 'notification/intent-persisted', persisted: true})
    const completed = coordinator.transition(plan.taskId, {type: 'task/complete-requested'})
    const continuation = resolveAutoContinuation({result: {outcome: 'incomplete', continuationReason: 'max_turns'}, decision: {executionMode: 'workflow', continuationPolicy: {maxRounds: 1}}, attempt: 0, hasConversation: true, taskActive: true})
    const context = planContext({profile: 'full', task: {goal: '验证上下文'}, memoryText: 'x'.repeat(12000), memoryCandidates: [{sourceKey: 'memory/smoke.md', title: 'Smoke', overview: '摘要', body: 'x'.repeat(12000)}], budget: {maxInputTokens: 300}})
    return {
        taskId: plan.taskId,
        stepStatuses: completed.plan.steps.map(step => step.status),
        blockedStatus: blocked.status,
        resumedStatus: completed.status,
        continuationCount: completed.execution.continuationCount,
        wakeCount: 0,
        estimatedUsage: {inputTokens: context.estimatedInputTokens, actualTokens: null},
        contextLayers: Object.entries(context.layers).filter(([, value]) => value.selected).map(([layer]) => layer),
        omitted: context.omitted,
        budgetStopReason: continuation.budget ? null : continuation.reason,
        duplicateEventIgnored: coordinator.getTaskSnapshot(plan.taskId).revision < events.length + 1,
    }
}
