import test from 'node:test'
import assert from 'node:assert/strict'
import {classifyTranscriptLines} from './transcript-classifier.mjs'

test('main transcript stays main after using Agent tools', () => {
    const lines = [
        JSON.stringify({type: 'queue-operation', sessionId: 'main-1'}),
        JSON.stringify({type: 'user', sessionId: 'main-1', isSidechain: false, agentId: 'agent-used-in-turn', parentUuid: null}),
    ]

    assert.equal(classifyTranscriptLines(lines), 'main')
})

test('顶层审查 Agent transcript 带 isSidechain false 时仍被过滤', () => {
    const lines = [
        JSON.stringify({type: 'user', sessionId: 'agent-top-level', isSidechain: false, message: {
            role: 'user',
            content: [{type: 'text', text: '对抗性验证此发现是否真实存在。不存在则返回 refuted:true:\n文件:FormMain.cs:10\n标题:测试问题'}],
        }}),
    ]

    assert.equal(classifyTranscriptLines(lines), 'agent')
})

test('普通用户审查请求不因包含审查二字被过滤', () => {
    const lines = [
        JSON.stringify({type: 'user', sessionId: 'main-review', isSidechain: false, message: {
            role: 'user',
            content: [{type: 'text', text: '请审查这个项目的连接逻辑，并直接修改发现的问题。'}],
        }}),
    ]

    assert.equal(classifyTranscriptLines(lines), 'main')
})

test('主会话后续收到内部审查反馈仍保持主会话', () => {
    const lines = [
        JSON.stringify({type: 'user', sessionId: 'main-repair', isSidechain: false, message: {
            role: 'user', content: [{type: 'text', text: '请实现扫码枪工艺切换功能。'}],
        }}),
        JSON.stringify({type: 'user', sessionId: 'main-repair', isSidechain: false, message: {
            role: 'user', content: [{type: 'text', text: '对抗性验证此发现是否真实存在。不存在则返回 refuted:true:\n内部历史消息'}],
        }}),
    ]

    assert.equal(classifyTranscriptLines(lines), 'main')
})

test('结构化 JSON 审查 Agent 协议可识别为 Agent transcript', () => {
    const lines = [
        JSON.stringify({type: 'user', sessionId: 'agent-audit', isSidechain: false, message: {
            role: 'user',
            content: [{type: 'text', text: '审查 D:/project 下的代码:\n安全问题: 注入漏洞、敏感信息泄露\n\n[IMPORTANT] You MUST output ONLY valid JSON matching: {"type":"object"}'}],
        }}),
    ]

    assert.equal(classifyTranscriptLines(lines), 'agent')
})

test('explicit sidechain transcript is classified as agent', () => {
    const lines = [
        JSON.stringify({type: 'system', sessionId: 'agent-1'}),
        JSON.stringify({type: 'assistant', sessionId: 'agent-1', isSidechain: true, agentId: 'agent-1', parentUuid: 'parent-1'}),
    ]

    assert.equal(classifyTranscriptLines(lines), 'agent')
})

test('legacy transcript without sidechain marker is preserved as unknown', () => {
    const lines = [
        JSON.stringify({type: 'user', sessionId: 'legacy-1'}),
        JSON.stringify({type: 'assistant', sessionId: 'legacy-1', message: {content: 'ok'}}),
    ]

    assert.equal(classifyTranscriptLines(lines), 'unknown')
})

test('invalid or truncated lines do not turn a transcript into an agent', () => {
    assert.equal(classifyTranscriptLines(['{"type":"user"', '', 'not-json']), 'unknown')
})
