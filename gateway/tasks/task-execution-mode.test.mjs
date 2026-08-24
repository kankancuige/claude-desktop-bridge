import assert from 'node:assert/strict'
import test from 'node:test'
import {consumeTaskRunBudget, createTaskRunBudget, normalizeContinuationPolicy, normalizeExecutionMode, resolveContinuation, validateStepDependencies} from './task-execution-mode.mjs'

test('默认执行模式是 session，workflow 和 mission 必须显式选择', () => {
    assert.equal(normalizeExecutionMode(), 'session')
    assert.equal(normalizeExecutionMode('workflow'), 'workflow')
    assert.equal(normalizeExecutionMode('mission'), 'mission')
    assert.equal(normalizeExecutionMode('daemon'), 'session')
    assert.equal(normalizeContinuationPolicy({}, 'session').enabled, false)
    assert.equal(normalizeContinuationPolicy({}, 'workflow').enabled, true)
})

test('预算规范化并在超出 Token 或轮次后阻止继续', () => {
    const budget = createTaskRunBudget({maxRounds: 2, maxTokens: 1000, startedAt: Date.now()}, 'workflow')
    const first = consumeTaskRunBudget(budget, {rounds: 1, tokens: 600})
    assert.equal(first.allowed, true)
    const second = consumeTaskRunBudget(first.budget, {rounds: 2, tokens: 500})
    assert.equal(second.allowed, false)
    assert.equal(second.reason, 'max_rounds')
})

test('固定 Workflow 只在有进展时继续，Mission 也受预算控制', () => {
    const budget = createTaskRunBudget({maxRounds: 3, maxTokens: 5000, startedAt: Date.now()}, 'mission')
    assert.deepEqual(resolveContinuation({mode: 'session', result: {completed: false}, budget}), {action: 'pause', reason: 'session_mode'})
    assert.deepEqual(resolveContinuation({mode: 'workflow', result: {completed: false}, budget, progress: false}), {action: 'pause', reason: 'no_progress'})
    assert.equal(resolveContinuation({mode: 'mission', result: {completed: false}, budget, progress: true}).action, 'continue')
})

test('步骤依赖拒绝未知引用和循环', () => {
    assert.throws(() => validateStepDependencies([{stepId: 'a', dependsOn: ['missing']}]), error => error.code === 'TASK_STEP_DEPENDENCY_MISSING')
    assert.throws(() => validateStepDependencies([{stepId: 'a', dependsOn: ['b']}, {stepId: 'b', dependsOn: ['a']}]), error => error.code === 'TASK_STEP_DEPENDENCY_CYCLE')
})
