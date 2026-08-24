import test from 'node:test'
import assert from 'node:assert/strict'
import {consumeTaskRunBudget, createTaskRunBudget, resolveContinuation} from './task-run-budget.mjs'

test('运行预算保留未知 token，不把未知 usage 当作零成本以外的事实', () => {
    const budget = createTaskRunBudget({maxRounds: 2, maxTokens: 100}, 'workflow')
    const result = consumeTaskRunBudget(budget, {rounds: 1, tokens: 0})
    assert.equal(result.allowed, true)
    assert.equal(result.budget.tokensUsed, 0)
    assert.equal(result.remaining.tokens, 1024)
})

test('预算达到边界后暂停，不继续请求模型', () => {
    const budget = createTaskRunBudget({maxRounds: 1}, 'workflow')
    const result = resolveContinuation({mode: 'workflow', budget, result: {outcome: 'incomplete'}, progress: true})
    assert.equal(result.action, 'continue')
    const next = resolveContinuation({mode: 'workflow', budget: result.budget, result: {outcome: 'incomplete'}, progress: true})
    assert.equal(next.action, 'pause')
    assert.equal(next.reason, 'max_rounds')
})

test('session 模式解析为暂停', () => {
    assert.deepEqual(resolveContinuation({mode: 'session', result: {outcome: 'incomplete'}}), {action: 'pause', reason: 'session_mode'})
})
