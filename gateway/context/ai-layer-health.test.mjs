import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {checkAiLayerHealth, detectRuleDrift} from './ai-layer-health.mjs'

test('资源健康检查识别缺失、关闭、定制和规则编码', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-health-'))
    mkdirSync(join(home, 'rules'))
    writeFileSync(join(home, 'rules', 'r.md'), 'bad \uFFFD', 'utf8')
    const manifest = {resources: [{id: 'r', type: 'rule', target: 'rules/r.md', required: true}, {id: 'a', type: 'agent', target: 'agents/a.md'}]}
    const report = checkAiLayerHealth({bridgeHome: home, manifest, resourceState: [{id: 'r', type: 'rule', installed: true, enabled: false, customized: true}, {id: 'a', type: 'agent', installed: false, enabled: true}]})
    assert.equal(report.healthy, false)
    assert.ok(report.issues.some(item => item.code === 'rule_encoding_invalid'))
    assert.ok(report.issues.some(item => item.code === 'resource_missing'))
})

test('规则漂移只产出事实候选，不自动修改资源', () => {
    const candidates = detectRuleDrift({executionReports: [{skills: {requested: ['vue'], matched: []}}, {skills: {requested: ['vue'], matched: []}}], pitfalls: [{id: 'p', status: 'confirmed'}]})
    assert.deepEqual(candidates.map(item => item.type), ['skill_route_gap', 'prevention_missing'])
})
