import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./model-context-switch.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {resolveConversationModel, resolveModelContextSwitch} = await import(moduleUrl)

test('SDK 初始化事件缺失模型时回退到已记录的任务路由模型', () => {
  assert.equal(resolveConversationModel({runtimeModel: '', taskModel: 'model-a'}), 'model-a')
  assert.equal(resolveConversationModel({runtimeModel: 'model-runtime', taskModel: 'model-a'}), 'model-runtime')
  assert.equal(resolveConversationModel({runtimeModel: '  ', taskModel: '  '}), '')
})

test('固定模式切换实际模型且已有历史时要求选择，默认完整历史', () => {
  assert.deepEqual(resolveModelContextSwitch({
    mode: 'fixed', currentModel: 'model-a', nextModel: 'model-b', hasConversation: true,
  }), {
    requiresChoice: true, mode: 'full_history', cacheEligibility: 'cross_model_unavailable',
    reason: 'model_changed',
  })
})

test('同模型、新会话和自动路由不会在发送前误阻断', () => {
  assert.equal(resolveModelContextSwitch({mode: 'fixed', currentModel: 'model-a', nextModel: 'model-a', hasConversation: true}).requiresChoice, false)
  assert.equal(resolveModelContextSwitch({mode: 'fixed', currentModel: '', nextModel: 'model-b', hasConversation: false}).requiresChoice, false)
  assert.equal(resolveModelContextSwitch({mode: 'auto', currentModel: 'model-a', nextModel: 'model-b', hasConversation: true}).requiresChoice, false)
})

test('重启后由持久化任务状态恢复模型时仍要求跨模型选择', () => {
  const currentModel = resolveConversationModel({runtimeModel: '', taskModel: 'model-a'})
  const decision = resolveModelContextSwitch({
    mode: 'fixed', currentModel, nextModel: 'model-b', hasConversation: true,
  })
  assert.equal(decision.requiresChoice, true)
  assert.equal(decision.cacheEligibility, 'cross_model_unavailable')
})

test('运行时事件缺失模型时，持久化任务状态仍阻止跨模型直接发送', () => {
  const currentModel = resolveConversationModel({
    runtimeModel: '', taskModel: '', persistedModel: 'model-a',
  })
  const decision = resolveModelContextSwitch({
    mode: 'fixed', currentModel, nextModel: 'model-b', hasConversation: true,
  })
  assert.equal(currentModel, 'model-a')
  assert.equal(decision.requiresChoice, true)
})
