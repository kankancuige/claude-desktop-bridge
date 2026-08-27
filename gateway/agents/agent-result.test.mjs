import assert from 'node:assert/strict'
import test from 'node:test'
import {normalizeAgentResult} from './agent-result.mjs'

test('AgentResult 统一必需字段并拒绝虚假测试通过', () => {
    const result = normalizeAgentResult({status: 'completed', summary: '完成', changedFiles: ['a.mjs'], tests: [{name: 'node --test', status: 'passed', executed: true}]}, {taskId: 't', stepId: 's', role: 'developer'})
    assert.equal(result.taskId, 't')
    assert.equal(result.tests[0].executed, true)
    assert.throws(() => normalizeAgentResult({status: 'completed', tests: [{status: 'passed'}]}), error => error?.code === 'FALSE_TEST_CLAIM')
    assert.throws(() => normalizeAgentResult('done'), error => error?.code === 'INVALID_AGENT_RESULT')
})

test('AgentResult 保留受约束的主任务写入请求', () => {
    const result = normalizeAgentResult({
        status: 'blocked',
        writeRequest: {requestedFiles: ['a.mjs', '', 'b.mjs'], requestedAction: '修复', reason: '需要主任务权限'},
    }, {taskId: 't', stepId: 's', role: 'reviewer'})
    assert.deepEqual(result.writeRequest, {
        requestedFiles: ['a.mjs', 'b.mjs'], requestedAction: '修复', reason: '需要主任务权限',
    })
})
