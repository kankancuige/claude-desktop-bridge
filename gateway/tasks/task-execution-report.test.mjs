import assert from 'node:assert/strict'
import test from 'node:test'
import {createTaskExecutionReport, summarizeTaskExecutionReport} from './task-execution-report.mjs'

test('执行报告记录计划偏离、跳过步骤、Agent 失败和验证证据', () => {
    const report = createTaskExecutionReport({taskId: 't', status: 'inconclusive', startedAt: 1, completedAt: 11,
        plan: {steps: [{stepId: '1', phase: 'implement', role: 'developer', status: 'completed'}, {stepId: '2', phase: 'validate', role: 'test-engineer', status: 'skipped'}, {stepId: '3', phase: 'report', role: 'developer', status: 'pending'}]},
        agents: {a: {status: 'failed', role: 'tester', stepId: '2'}}, verification: {status: 'not_verified', evidenceLevel: 'L0'}, blockers: [{code: 'test_missing'}]},
    {requestedSkills: ['vue'], matchedSkills: []})
    assert.equal(report.deviations.skippedSteps.length, 1)
    assert.equal(report.deviations.unfinishedSteps.length, 1)
    assert.equal(report.deviations.agentFailures.length, 1)
    assert.equal(summarizeTaskExecutionReport(report).unresolvedRisks, 1)
})
