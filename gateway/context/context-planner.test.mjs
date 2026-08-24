import assert from 'node:assert/strict'
import test from 'node:test'
import {createContextPlanner, materializeContextLayer, planContext, recordContextUse} from './context-planner.mjs'

test('light/focused/full 按层加载上下文，默认不让 light 读取正文', () => {
    const input = {task: {goal: '修复登录'}, projectSummary: 'Vue + Node 项目', memoryCandidates: [{sourceKey: 'memory/a.md', title: '登录约定', overview: '使用统一会话', body: '正文内容'}], memoryText: '正文内容'}
    assert.equal(planContext({...input, profile: 'light'}).layers.l2.selected, false)
    assert.equal(planContext({...input, profile: 'focused'}).layers.l1.selected, true)
    assert.equal(planContext({...input, profile: 'full'}).layers.l2.selected, false)
    assert.equal(planContext({...input, profile: 'full', references: ['memory/a.md']}).layers.l2.selected, true)
})

test('输入预算不足时裁剪详情并记录原因', () => {
    const plan = planContext({profile: 'full', task: {goal: '目标'}, memoryCandidates: [{sourceKey: 'm', title: 'M', overview: '概览', body: 'x'.repeat(20_000)}], budget: {maxInputTokens: 300}})
    assert.ok(plan.omitted.some(item => item.layer === 'l2'))
    assert.equal(plan.reason, 'budget_applied')
    assert.ok(plan.estimatedInputTokens <= 300)
})

test('Context 使用事件不包含正文', () => {
    const event = recordContextUse({taskId: 't1', reference: 'memory/a.md', layer: 'l1', selected: true, bytes: 120, reason: 'profile_allows_overview'})
    assert.deepEqual(event, {type: 'context/use', taskId: 't1', reference: 'memory/a.md', layer: 'l1', selected: true, bytes: 120, reason: 'profile_allows_overview', at: event.at})
    assert.equal('text' in event, false)
})

test('可注入自定义 logger 且保留纯函数导出', () => {
    const logs = []
    const planner = createContextPlanner({logger: {debug: value => logs.push(value)}})
    planner.planContext({profile: 'light', task: {goal: '测试'}})
    assert.equal(logs.length, 1)
})

test('Memory 聚合正文只进入一次，reference 会筛选对应层内容', () => {
    const plan = planContext({
        profile: 'full',
        task: {goal: '实现 Memory 优化'},
        memoryText: '来源: memory/a.md\n标题: A\nA body\n\n来源: memory/b.md\n标题: B\nB body',
        memoryCandidates: [
            {sourceKey: 'memory/a.md', title: 'A', overview: 'A overview'},
            {sourceKey: 'memory/b.md', title: 'B', overview: 'B overview'},
        ],
        references: ['memory/b.md'], budget: {maxInputTokens: 4000},
    })
    assert.equal((plan.layers.l1.text.match(/来源: memory\/a\.md/g) || []).length, 0)
    assert.equal(materializeContextLayer({plan, layer: 'l2', reference: 'memory/b.md'}).text.includes('memory/b.md'), true)
    assert.equal(materializeContextLayer({plan, layer: 'l2', reference: 'missing.md'}).reason, 'reference_not_found')
})
