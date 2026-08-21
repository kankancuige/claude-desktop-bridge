import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildProjectContinuationContext,
    composeContinuationPrompt,
    buildModelHandoffPrompt,
    isReferentialContinuation,
} from './project-continuation-context.mjs'

function line(entry) {
    return JSON.stringify(entry)
}

function transcript({id, user, assistant, isSidechain = false, mtime = 1}) {
    const lines = []
    for (let i = 0; i < user.length; i++) {
        lines.push(line({
            type: 'user', sessionId: id, isSidechain,
            message: {role: 'user', content: [{type: 'text', text: user[i]}]},
        }))
        if (assistant[i]) {
            lines.push(line({
                type: 'assistant', sessionId: id, isSidechain,
                message: {role: 'assistant', content: [{type: 'text', text: assistant[i]}]},
            }))
        }
    }
    return {id, mtime, content: lines.join('\n')}
}

test('只有明确省略关系的短句触发跨会话接力', () => {
    for (const text of ['继续', '加上', '接着做', '按刚才的修改吧', '继续完成上一个任务']) {
        assert.equal(isReferentialContinuation(text), true, text)
    }
    for (const text of ['检查 Form1 协议实现', '继续分析这个新的日志错误，错误码是 401', '新增一个独立设置页']) {
        assert.equal(isReferentialContinuation(text), false, text)
    }
})

test('模型 handoff 只发送有限状态摘要，并标注不能替代完整历史', () => {
    const handoff = buildModelHandoffPrompt({
        prompt: '继续修复',
        session: {taskState: {detail: '已定位根因'}, taskCompletion: {phase: 'fixing'}, taskReviewFiles: [{path: 'gateway/index.mjs'}]},
    })
    assert.match(handoff, /bridge-model-handoff/)
    assert.match(handoff, /可能遗漏细节/)
    assert.match(handoff, /gateway\/index\.mjs/)
    assert.ok(handoff.endsWith('===== 当前用户消息 =====\n继续修复'))
})

test('选择最近的实质主会话并跳过断裂续话与 agent transcript', () => {
    const result = buildProjectContinuationContext({
        prompt: '加上',
        currentSessionId: 'current',
        transcripts: [
            transcript({id: 'main', mtime: 10, user: ['为 Form1 增加工单下发区域和按钮'], assistant: ['已定位控件和事件处理位置，下一步修改代码。']}),
            transcript({id: 'broken', mtime: 30, user: ['加上'], assistant: ['请说明要加什么内容，以及加到哪个文件。']}),
            transcript({id: 'agent', mtime: 40, isSidechain: true, user: ['扫描项目'], assistant: ['扫描完成。']}),
            transcript({id: 'current', mtime: 50, user: ['当前'], assistant: ['当前回复']}),
        ],
    })
    assert.equal(result?.sourceSessionId, 'main')
    assert.match(result?.text || '', /Form1/)
    assert.doesNotMatch(result?.text || '', /请说明要加什么/)
})

test('普通首问或已有用户回合时不构建接力上下文', () => {
    const transcripts = [transcript({id: 'main', user: ['旧任务'], assistant: ['旧结果']})]
    assert.equal(buildProjectContinuationContext({prompt: '分析新的协议', transcripts}), null)
    assert.equal(buildProjectContinuationContext({prompt: '继续', hasUserTurns: true, transcripts}), null)
})

test('接力文本限制长度且组合后保留真实用户消息边界', () => {
    const result = buildProjectContinuationContext({
        prompt: '继续',
        maxChars: 6000,
        transcripts: [transcript({id: 'main', user: ['任务' + 'A'.repeat(8000)], assistant: ['结果' + 'B'.repeat(8000)]})],
    })
    assert.ok(result)
    assert.ok(result.text.length <= 6000)
    const combined = composeContinuationPrompt('继续', result)
    assert.match(combined, /bridge-project-continuation/)
    assert.ok(combined.endsWith('===== 用户消息 =====\n继续'))
})

test('成功接力产生的新 transcript 可以承接最新结果而不显示内部块', () => {
    const inherited = {
        sourceSessionId: 'source',
        text: '用户任务: 为 Form1 增加工单下发区域和按钮\nAI结果: 已定位控件。',
    }
    const content = [
        line({type: 'user', isSidechain: false, message: {content: [{type: 'text', text: composeContinuationPrompt('加上', inherited)}]}}),
        line({type: 'assistant', isSidechain: false, message: {content: [{type: 'text', text: '已完成按钮和事件实现，并通过构建。'}]}}),
    ].join('\n')
    const result = buildProjectContinuationContext({
        prompt: '继续',
        transcripts: [{id: 'continued', mtime: 20, content}],
    })
    assert.equal(result?.sourceSessionId, 'continued')
    assert.match(result?.text || '', /当前任务: 为 Form1 增加工单下发区域和按钮/)
    assert.doesNotMatch(result?.text || '', /bridge-project-continuation/)
})
