import assert from 'node:assert/strict'
import test from 'node:test'
import {createWorkbenchRepository} from './workbench-repository.mjs'

function adapter() {
    return {
        getTaskState: () => ({projectKey: 'p', taskKey: 's:t1', taskId: 's:t1', sessionId: 'gw', status: 'running', revision: 4, updatedAt: 20, state: {plan: {goal: '实现功能'}, detail: '状态摘要', sessionId: 'gw', turnId: 't1'}}),
        listTaskStates: () => [],
        recordTaskTransition: () => true,
        listTaskEvents: () => [
            {projectKey: 'p', taskKey: 's:t1', revision: 2, eventType: 'task/input-appended', createdAt: 12, payload: {taskId: 's:t1', sessionId: 'gw', turnId: 't2', summary: '补充问题'}},
            {projectKey: 'p', taskKey: 's:t1', revision: 1, eventType: 'task/created', createdAt: 10, payload: {taskId: 's:t1', sessionId: 'gw', turnId: 't1', requestText: '初始问题'}},
        ],
        getExecutionReport: () => null,
    }
}

test('Workbench Repository 为旧任务补齐可读元数据并生成有序问题列表', () => {
    const repository = createWorkbenchRepository({stateStore: adapter()})
    const detail = repository.getTaskDetail({projectKey: 'p', taskId: 's:t1'})
    assert.equal(detail.task.title, '实现功能')
    assert.equal(detail.task.summary, '状态摘要')
    assert.deepEqual(detail.questions.map(item => item.turnId), ['t1', 't2'])
    assert.equal(detail.questions[1].text, '补充问题')
})
