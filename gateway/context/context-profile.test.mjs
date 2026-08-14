import test from 'node:test'
import assert from 'node:assert/strict'
import {applyContextProfile, classifyContextProfile, nextContextProfile} from './context-profile.mjs'

test('简单对话和短概念问题使用轻量上下文', () => {
    for (const text of ['你好', '你是什么模型？', '什么是依赖注入？', '什么是 API？', '什么是 MCP？', '解释一下闭包']) {
        assert.equal(classifyContextProfile(text), 'light', text)
    }
})

test('写入、执行和实时信息请求使用完整上下文', () => {
    const cases = [
        '请修改 gateway/index.mjs 修复这个 bug',
        '当前项目的会话加上按钮',
        '给当前项目的会话加个按钮',
        '帮当前项目加个按钮',
        '给项目补一个功能',
        '给 Form1 添加一个下发工单按钮',
        '在当前项目增加附件发送状态',
        '优化一下 Form1.cs',
        '帮我把 Form1 改一下',
        '处理一下这个 bug',
        '把这个功能做出来',
        '完善一下功能',
        '补齐功能',
        '给按钮加点击事件',
        '现在东京天气怎么样？',
        '运行测试并修复失败用例',
    ]
    for (const text of cases) assert.equal(classifyContextProfile(text), 'full', text)
})

test('只有明确只读限制才使用聚焦只读上下文', () => {
    for (const text of ['只看 #README.md 里写了什么，不要修改', '仅分析当前项目，不要执行命令', '只读检查这个文件']) {
        assert.equal(classifyContextProfile(text), 'focused', text)
    }
    for (const text of ['看看 #README.md 里写了什么', '```js\nconsole.log(1)\n```\n这段代码哪里错了']) {
        assert.equal(classifyContextProfile(text), 'focused', text)
    }
    for (const text of ['@reviewer 审查当前项目', '检查当前项目有什么问题']) assert.equal(classifyContextProfile(text), 'full', text)
})

test('轻量配置关闭工具、Skills、MCP、设置扫描和扩展思考', () => {
    const original = {
        model: 'gpt-5.6-sol',
        tools: {type: 'preset', preset: 'claude_code'},
        skills: 'all',
        settingSources: ['user', 'project', 'local'],
        mcpServers: {demo: {type: 'http', url: 'https://example.com'}},
        agents: {reviewer: {description: 'review', prompt: 'review'}},
        thinking: {type: 'enabled', budgetTokens: 16000},
    }
    const light = applyContextProfile(original, 'light', 'gpt-5.6-sol')
    assert.deepEqual(light.tools, [])
    assert.deepEqual(light.skills, [])
    assert.deepEqual(light.settingSources, [])
    assert.deepEqual(light.mcpServers, {})
    assert.equal(light.agents, undefined)
    assert.equal(light.strictMcpConfig, true)
    assert.deepEqual(light.thinking, {type: 'disabled'})
    assert.match(light.systemPrompt, /gpt-5\.6-sol/)
    assert.match(light.systemPrompt, /不得调用工具/)
    assert.deepEqual(original.tools, {type: 'preset', preset: 'claude_code'})
})

test('完整配置保持调用方原始选项', () => {
    const original = {model: 'gpt-5.6-sol', tools: ['Read'], skills: ['db-sql']}
    const full = applyContextProfile(original, 'full', 'gpt-5.6-sol')
    assert.notEqual(full, original)
    assert.deepEqual(full.settingSources, [])
    assert.equal(full.model, original.model)
    assert.deepEqual(full.tools, original.tools)
    assert.match(full.systemPrompt.append, /Bridge 自有长期规则/)
})

test('只读审查和解释请求不会获得写入能力', () => {
    assert.equal(classifyContextProfile('只分析 gateway/index.mjs，不要修改代码'), 'focused')
    assert.equal(classifyContextProfile('什么是依赖注入？'), 'light')
    assert.equal(classifyContextProfile('修改 gateway/index.mjs 修复这个 bug'), 'full')
    assert.equal(classifyContextProfile('只分析当前项目怎么加上按钮，不要修改代码'), 'focused')
    assert.equal(classifyContextProfile('不要只分析，直接给当前项目加上按钮'), 'full')
    assert.equal(classifyContextProfile('不要只看方案，直接实现这个功能'), 'full')
    const focused = applyContextProfile({skills: ['protocol-parser'], mcpServers: {demo: {}}}, 'focused', 'gpt-5.6-sol')
    assert.deepEqual(focused.tools, ['Read', 'Grep', 'Glob'])
    assert.deepEqual(focused.allowedTools, ['Read', 'Grep', 'Glob'])
    assert.deepEqual(focused.mcpServers, {})
    assert.deepEqual(focused.settingSources, [])
    assert.equal(focused.agents, undefined)
    assert.match(focused.systemPrompt, /只允许读取和分析/)
})

test('独立简单问题允许从 full 降级，继续当前任务保持 full', () => {
    assert.equal(nextContextProfile('light', '你好'), 'light')
    assert.equal(nextContextProfile('light', '修复 gateway/index.mjs'), 'full')
    assert.equal(nextContextProfile('full', '你好'), 'light')
    assert.equal(nextContextProfile('full', '继续'), 'full')
    assert.equal(nextContextProfile('full', '继续解释这个词'), 'light')
    assert.equal(nextContextProfile('full', '好的，继续'), 'full')
    assert.equal(nextContextProfile('full', '嗯，接着做'), 'full')
    assert.equal(nextContextProfile('full', '那就继续处理'), 'full')
    assert.equal(nextContextProfile('full', '只审查这个文件，不要修改'), 'focused')
    assert.equal(nextContextProfile('full', '检查这个文件并修复问题'), 'full')
})

test('已进入只读分析的会话收到口语化实现请求时升级为完整上下文', () => {
    for (const text of ['给当前项目的会话加个按钮', '帮当前项目加个按钮', '给项目补一个功能', '给 Form1 加按钮', '补功能']) {
        assert.equal(nextContextProfile('focused', text), 'full', text)
    }
    assert.equal(nextContextProfile('focused', '只分析怎么加个按钮，不要修改代码'), 'focused')
    assert.equal(nextContextProfile('focused', '不要只分析，直接给当前项目加上按钮'), 'full')
})
