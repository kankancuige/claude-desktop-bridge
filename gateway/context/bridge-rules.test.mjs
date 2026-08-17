import test from 'node:test'
import assert from 'node:assert/strict'
import {BRIDGE_RULES, BRIDGE_RULES_PATH, appendBridgeRules} from './bridge-rules.mjs'

test('Bridge 规则来自仓库内固定文件并包含核心纪律', () => {
    assert.match(BRIDGE_RULES_PATH, /gateway[\\/]context[\\/]BRIDGE_RULES\.md$/)
    assert.match(BRIDGE_RULES, /唯一的跨项目长期规则来源/)
    assert.match(BRIDGE_RULES, /Code review 只在用户明确要求审查/)
    assert.match(BRIDGE_RULES, /简单问候、模型身份和短概念问题不调用工具/)
    assert.match(BRIDGE_RULES, /不得写死或记录到日志/)
    assert.match(BRIDGE_RULES, /Gateway 结构化事件或权威快照/)
    assert.match(BRIDGE_RULES, /不透明纯色表面/)
    assert.match(BRIDGE_RULES, /1200x700/)
    assert.match(BRIDGE_RULES, /WorkspaceView.*keep-alive/)
})

test('Bridge 规则追加到 Claude Code preset，不读取外部规则文件', () => {
    const prompt = appendBridgeRules({type: 'preset', preset: 'claude_code', append: '已有 Bridge 提示'})
    assert.equal(prompt.type, 'preset')
    assert.equal(prompt.preset, 'claude_code')
    assert.match(prompt.append, /已有 Bridge 提示/)
    assert.match(prompt.append, /Bridge 自有长期规则/)
    assert.doesNotMatch(prompt.append, /CLAUDE\.md.*必须加载/)
})
