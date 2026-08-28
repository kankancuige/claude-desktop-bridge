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

test('Workbench Repository 将历史占位标题替换为摘要首行', () => {
    const stateStore = adapter()
    stateStore.getTaskState = () => ({projectKey: 'p', taskKey: 's:t2', taskId: 's:t2', status: 'succeeded', state: {title: '未命名任务', summary: '修复任务列表标题\n后续说明'}})
    const task = createWorkbenchRepository({stateStore}).getTask({projectKey: 'p', taskId: 's:t2'})
    assert.equal(task.title, '修复任务列表标题')
})

test('Workbench Repository 从历史 task/created 事件恢复无摘要任务标题', () => {
    const stateStore = adapter()
    const row = {projectKey: 'p', taskKey: 's:t3', taskId: 's:t3', status: 'failed', state: {}}
    stateStore.getTaskState = () => row
    stateStore.listTaskStates = () => [row]
    stateStore.listTaskEvents = () => [{eventType: 'task/created', payload: {title: '修复连接超时', summary: '修复连接超时\n补充说明', goal: '修复连接超时', requestText: '请修复连接超时'}}]
    const task = createWorkbenchRepository({stateStore}).listTasks({projectKey: 'p'})[0]
    assert.equal(task.title, '修复连接超时')
    assert.equal(task.requestText, '请修复连接超时')
})
