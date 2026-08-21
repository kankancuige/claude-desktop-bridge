import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./model-context-switch.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {resolveModelContextSwitch} = await import(moduleUrl)

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
