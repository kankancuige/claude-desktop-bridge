import test from 'node:test'
import assert from 'node:assert/strict'
import {parseSessionHistory} from './session-history.mjs'

test('历史消息隐藏内部 wire 前缀并保留思考和工具调用', () => {
    const messages = parseSessionHistory([
        JSON.stringify({type: 'user', timestamp: '2026-01-01T00:00:00.000Z', message: {content: '[系统] 附件路径\n===== 用户消息 =====\n请继续'}}),
        JSON.stringify({type: 'assistant', timestamp: '2026-01-01T00:00:01.000Z', message: {content: [
            {type: 'thinking', thinking: '先检查状态'},
            {type: 'tool_use', id: 'tool-1', name: 'Read', input: {file_path: 'README.md'}},
            {type: 'text', text: '已检查。'},
        ]}}),
        '{truncated',
    ].join('\n'))
    assert.deepEqual(messages, [
        {role: 'user', text: '请继续', time: '2026-01-01T00:00:00.000Z'},
        {role: 'thinking', text: '思考内容', thinkingContent: '先检查状态', time: '2026-01-01T00:00:01.000Z'},
        {role: 'assistant', text: '已检查。', tools: [{tool_name: 'Read', tool_use_id: 'tool-1', input: {file_path: 'README.md'}}], time: '2026-01-01T00:00:01.000Z'},
    ])
})

test('历史消息过滤 SDK 合成的 compact summary', () => {
    const content = [
        JSON.stringify({type: 'user', message: {isCompactSummary: true, content: [{type: 'text', text: 'This session is being continued...'}]}}),
        JSON.stringify({type: 'user', message: {content: [{type: 'text', text: '压缩后继续的问题'}]}}),
    ].join('\n')
    assert.deepEqual(parseSessionHistory(content).map(item => item.text), ['压缩后继续的问题'])
})

test('历史消息隐藏 Bridge 内部 Workflow 结果回灌', () => {
    const content = [
        JSON.stringify({type: 'user', message: {content: [{type: 'text', text: '[Bridge Workflow Result:wf-1]\n[Workflow "review" 完成]\n内部结果'}]}}),
        JSON.stringify({type: 'assistant', message: {content: [{type: 'text', text: '面向用户的最终答复'}]}}),
    ].join('\n')
    assert.deepEqual(parseSessionHistory(content).map(item => item.text), ['面向用户的最终答复'])
})

test('历史消息恢复附件名称、类型、路径和已发送状态', () => {
    const content = JSON.stringify({type: 'user', message: {content: [
        {type: 'text', text: '[系统] 用户发送了 2 个附件。\n- 需求.docx | 类型: document | 路径: .bridge-uploads/s1/upload-1.docx\n===== 图片: 截图.png (.bridge-uploads/s1/upload-2.png) =====\n===== 用户消息 =====\n请处理'},
    ]}})
    const [message] = parseSessionHistory(content)
    assert.equal(message.text, '请处理')
    assert.deepEqual(message.attachments.map(item => ({name: item.name, attachmentKind: item.attachmentKind, uploadedPath: item.uploadedPath, status: item.status})), [
        {name: '需求.docx', attachmentKind: 'document', uploadedPath: '.bridge-uploads/s1/upload-1.docx', status: 'sent'},
        {name: '截图.png', attachmentKind: 'image', uploadedPath: '.bridge-uploads/s1/upload-2.png', status: 'sent'},
    ])
})
