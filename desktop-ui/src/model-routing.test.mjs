import test from 'node:test'
import assert from 'node:assert/strict'
import {buildModelSelectionPayload, describeTaskDecision, normalizeModelMode} from './model-routing.mjs'

test('自动模式不向 Gateway 发送固定模型字段', () => {
  assert.deepEqual(buildModelSelectionPayload({
    mode: 'auto', model: 'model-power', modelMeta: {contextWindow: 256000},
  }), {modelMode: 'auto'})
})

test('固定模式保留用户选择的模型和元数据', () => {
  assert.deepEqual(buildModelSelectionPayload({
    mode: 'fixed', model: 'model-user', modelMeta: {contextWindow: 128000},
  }), {
    modelMode: 'fixed', model: 'model-user', modelMeta: {contextWindow: 128000},
  })
})

test('旧标签页缺少模式时按自动模式恢复', () => {
  assert.equal(normalizeModelMode(undefined), 'auto')
  assert.equal(normalizeModelMode('fixed'), 'fixed')
})

test('任务决策描述只显示稳定摘要且不展开 Prompt', () => {
  const text = describeTaskDecision({
    modelMode: 'auto', modelTier: 'power', risk: 'high', model: 'gpt-power',
    reasons: ['用户输入中的长 Prompt 不应出现在摘要'],
  })
  assert.equal(text, '自动 · Power · 高风险 · gpt-power')
  assert.doesNotMatch(text, /Prompt/)
})
