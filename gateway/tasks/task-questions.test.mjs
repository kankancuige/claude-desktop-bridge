import assert from 'node:assert/strict'
import test from 'node:test'
import {buildTaskQuestions} from './task-questions.mjs'

test('任务问题由根请求和补充指令组成，并保留各自回合关联', () => {
    const questions = buildTaskQuestions({taskId: 's:t1', sessionId: 'gw', requestText: '初始请求'}, [
        {eventType: 'task/created', revision: 10, createdAt: 100, payload: {taskId: 's:t1', sessionId: 'gw', turnId: 't1', requestText: '初始请求', summary: '初始摘要'}},
        {eventType: 'task/input-appended', revision: 11, createdAt: 110, payload: {taskId: 's:t1', sessionId: 'gw', turnId: 't2', requestText: '补充问题', summary: '补充问题'}},
    ])
    assert.equal(questions.length, 2)
    assert.equal(questions[0].questionId, 's:t1#10')
    assert.equal(questions[1].turnId, 't2')
    assert.equal(questions[1].text, '补充问题')
})

test('旧任务没有事件时生成一个可读的兼容问题', () => {
    const questions = buildTaskQuestions({taskId: 'legacy', requestText: '旧任务请求', createdAt: 42}, [])
    assert.deepEqual(questions.map(item => item.text), ['旧任务请求'])
    assert.equal(questions[0].revision, 0)
})
