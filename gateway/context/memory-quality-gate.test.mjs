import assert from 'node:assert/strict'
import test from 'node:test'
import {enableMemorySemanticMode, evaluateMemoryQuality} from './memory-quality-gate.mjs'

const cases = [
    {query: '编码约定', expectedSourceKeys: ['memory/conventions.md']},
    {query: '发布流程', expectedSourceKeys: ['memory/release.md']},
]

test('质量评测计算 recall/precision 并拒绝基线回归', () => {
    const result = evaluateMemoryQuality({
        cases,
        keywordSearch: query => query === '编码约定' ? [{sourceKey: 'memory/conventions.md'}] : [{sourceKey: 'memory/release.md'}],
        semanticSearch: query => query === '编码约定' ? [{sourceKey: 'memory/conventions.md'}] : [{sourceKey: 'memory/unrelated.md'}],
        minRecall: 0.5, minPrecision: 0.5,
    })
    assert.equal(result.candidate.recall, 0.5)
    assert.equal(result.candidate.precision, 0.5)
    assert.equal(result.passed, false)
    assert.ok(result.reasons.includes('语义召回导致关键词基线命中回归'))
})

test('项目必须显式启用且通过质量、向量健康和维度门禁', () => {
    const common = {projectKey: 'p', quality: {passed: true}, vectorHealth: {healthy: true, enabled: true}, embeddingModel: 'm', dimensions: 3}
    assert.equal(enableMemorySemanticMode(common).reason, 'project_not_explicitly_enabled')
    assert.equal(enableMemorySemanticMode({...common, projectSetting: {enabled: true}}).enabled, true)
    assert.equal(enableMemorySemanticMode({...common, projectSetting: {enabled: true}, quality: {passed: false}}).reason, 'quality_gate_failed')
    assert.equal(enableMemorySemanticMode({...common, projectSetting: {enabled: true}, vectorHealth: {healthy: false, enabled: true}}).reason, 'vector_health_failed')
})
