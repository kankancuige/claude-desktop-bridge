import assert from 'node:assert/strict'
import test from 'node:test'
import {extractAutomaticMemoryFacts, extractAutomaticMemoryFactsFromSession} from './memory-auto-capture.mjs'

test('只从明确长期记忆表达生成有证据 candidate', () => {
    const facts = extractAutomaticMemoryFacts({
        taskId: 'task-1', projectKey: 'D--work',
        requestText: '请记住：本项目统一使用 UTF-8。\n普通问题不要沉淀。\n项目约定：所有 SQL 必须参数化。',
    })
    assert.deepEqual(facts.map(item => item.summary), ['本项目统一使用 UTF-8', '所有 SQL 必须参数化'])
    assert.equal(facts[0].verified, true)
    assert.deepEqual(facts[0].evidence, ['request:task-1'])
    assert.equal(facts[0].capture, 'automatic-explicit')
})

test('普通对话、拒绝记忆和凭据内容不会自动沉淀', () => {
    const facts = extractAutomaticMemoryFacts({
        taskId: 'task-2', projectKey: 'P',
        requestText: '帮我看看这个问题。不要记住：临时 token=sk-secret-12345678。',
    })
    assert.deepEqual(facts, [])
})

test('会话提取使用项目编码和原始任务文本，不读取最终回复猜测', () => {
    const facts = extractAutomaticMemoryFactsFromSession({
        session: {workDir: 'D:/work', taskCompletionTaskId: 'task-3', taskRequestText: '以后都使用 PostgreSQL'},
        encodeProjectName: value => `encoded:${value}`,
    })
    assert.equal(facts.length, 1)
    assert.equal(facts[0].summary, '使用 PostgreSQL')
    assert.deepEqual(facts[0].evidence, ['request:task-3'])
})
