import assert from 'node:assert/strict'
import test from 'node:test'
import {decideMemoryScalePolicy} from './memory-scale-policy.mjs'

test('规模策略按数量划分边界', () => {
    assert.equal(decideMemoryScalePolicy({count: 99}).mode, 'flat')
    assert.equal(decideMemoryScalePolicy({count: 100}).mode, 'summary')
    assert.equal(decideMemoryScalePolicy({count: 499}).mode, 'summary')
    assert.equal(decideMemoryScalePolicy({count: 500}).mode, 'hierarchical')
})

test('质量和注入预算可以提前触发升级建议', () => {
    assert.equal(decideMemoryScalePolicy({count: 10, keywordRecall: 0.7}).mode, 'summary')
    assert.equal(decideMemoryScalePolicy({count: 10, keywordRecall: 0.5}).mode, 'hierarchical')
    assert.equal(decideMemoryScalePolicy({count: 10, injectionBytes: 6143}).mode, 'hierarchical')
})
