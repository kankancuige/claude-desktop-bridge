import assert from 'node:assert/strict'
import test from 'node:test'
import {mapLegacyCompletionToCoordinator, mapVerificationToCoordinator, restoreCoordinatorSnapshot} from './coordinator-compatibility.mjs'
import {createTaskPlan} from './task-plan.mjs'
import {createTaskSnapshot} from './task-coordinator.mjs'

function snapshot(phases = ['implement', 'validate', 'report']) {
    return createTaskSnapshot({plan: createTaskPlan({taskId: 'task-1', turnId: 'turn-1', sessionId: 'session-1', phases, reviewRequired: phases.includes('review'), createdAt: 1}), now: 1})
}

test('SDK 成功只推进执行和验证，不把未执行验证伪造成完成', () => {
    const events = mapLegacyCompletionToCoordinator(snapshot(), {type: 'primary_result', result: {outcome: 'succeeded'}})
    assert.deepEqual(events.map(item => item.type), ['phase/completed', 'phase/started'])
    assert.equal(events[0].phase, 'implement')
    assert.equal(events[1].phase, 'validate')
    assert.deepEqual(events.map(item => item.revision), [2, 3])
})

test('真实验证通过后才完成 validate 与 report', () => {
    const events = mapVerificationToCoordinator(snapshot(), {status: 'passed', evidenceLevel: 'L2', testsExecuted: true, summary: '测试通过'})
    assert.deepEqual(events.map(item => item.type), ['verification/result', 'phase/completed', 'phase/completed'])
    assert.deepEqual(events.map(item => item.phase), [undefined, 'validate', 'report'])
})

test('审查未完成或 Workflow 迟到时不会生成完成请求', () => {
    const events = mapLegacyCompletionToCoordinator(snapshot(['implement', 'validate', 'review', 'report']), {type: 'primary_result', result: {outcome: 'succeeded'}})
    assert.equal(events.some(item => item.type === 'task/complete-requested'), false)
    assert.equal(events.at(-1).phase, 'validate')
})

test('运行时失败、审查错误和用户暂停具有稳定的非完成映射', () => {
    const state = snapshot()
    assert.equal(mapLegacyCompletionToCoordinator(state, {type: 'runtime_failed'}).at(-1).type, 'task/blocked')
    assert.equal(mapLegacyCompletionToCoordinator(state, {type: 'review_error'}).at(-1).type, 'task/blocked')
    assert.equal(mapLegacyCompletionToCoordinator(state, {type: 'user_stopped'}).at(-1).type, 'task/paused')
})

test('重启恢复保留 Task ID，并把活动执行显式降级为待继续状态', () => {
    const restored = restoreCoordinatorSnapshot({
        taskId: 'task-1', sessionId: 'session-1', status: 'verifying', revision: 7, sequence: 6,
        startedAt: 10, updatedAt: 20,
        state: {
            taskId: 'task-1', turnId: 'turn-1', sequence: 6,
            coordinator: {
                phase: 'validate', revision: 7,
                steps: [{stepId: 'task-1:step:1', phase: 'validate', role: 'test-engineer', status: 'running', required: true}],
                agents: {a1: {role: 'test-engineer', status: 'running'}},
                workflows: {w1: {status: 'running'}},
                verification: {status: 'candidate_running', evidenceLevel: 'L2', testsExecuted: true},
                blockerCodes: [], notificationIntentPersisted: false,
            },
        },
    }, {workDir: 'D:\\demo', now: 100})
    assert.equal(restored.taskId, 'task-1')
    assert.equal(restored.status, 'inconclusive')
    assert.equal(restored.plan.steps[0].status, 'pending')
    assert.equal(restored.agents.a1.status, 'interrupted')
    assert.equal(restored.workflows.w1.status, 'interrupted')
    assert.equal(restored.notificationIntentPersisted, false)
    assert.equal(restored.blockers.at(-1).code, 'coordinator_restart_interrupted')
})
