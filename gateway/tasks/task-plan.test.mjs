import assert from 'node:assert/strict'
import test from 'node:test'
import {createTaskPlan} from './task-plan.mjs'

test('TaskPlan 生成稳定任务、回合、步骤和角色标识', () => {
    const plan = createTaskPlan({taskId: 't1', turnId: 'turn1', goal: '修复', metadata: {title: '修复登录', summary: '处理超时', goal: '修复', requestText: '请修复', source: 'desktop'}, phases: ['implement', 'validate', 'report'], createdAt: 1})
    assert.equal(plan.taskId, 't1')
    assert.deepEqual({title: plan.title, summary: plan.summary, goal: plan.goal, requestText: plan.requestText, source: plan.source}, {title: '修复登录', summary: '处理超时', goal: '修复', requestText: '请修复', source: 'desktop'})
    assert.deepEqual(plan.steps.map(item => item.stepId), ['t1:step:1', 't1:step:2', 't1:step:3'])
    assert.deepEqual(plan.steps.map(item => item.role), ['developer', 'test-engineer', 'developer'])
    assert.equal(plan.executionMode, 'session')
    assert.deepEqual(plan.steps.map(item => item.dependsOn), [[], ['t1:step:1'], ['t1:step:2']])
})

test('明确执行到计划结束时使用 workflow，不启用 mission', () => {
    const plan = createTaskPlan({taskId: 'workflow-task', phases: ['plan', 'implement', 'validate'], continueToEnd: true})
    assert.equal(plan.executionMode, 'workflow')
    assert.equal(plan.continuationPolicy.enabled, true)
    assert.equal(plan.steps.length, 3)
})
