import assert from 'node:assert/strict'
import test from 'node:test'
import {createTaskPlan} from './task-plan.mjs'

test('TaskPlan 生成稳定任务、回合、步骤和角色标识', () => {
    const plan = createTaskPlan({taskId: 't1', turnId: 'turn1', goal: '修复', phases: ['implement', 'validate', 'report'], createdAt: 1})
    assert.equal(plan.taskId, 't1')
    assert.deepEqual(plan.steps.map(item => item.stepId), ['t1:step:1', 't1:step:2', 't1:step:3'])
    assert.deepEqual(plan.steps.map(item => item.role), ['developer', 'test-engineer', 'developer'])
})
