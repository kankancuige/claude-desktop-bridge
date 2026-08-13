import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./task-result-outcome.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {buildContinuationPrompt, normalizeTaskResult} = await import(moduleUrl)

test('successful result uses the completed presentation', () => {
  assert.deepEqual(normalizeTaskResult({subtype: 'success', outcome: 'succeeded'}), {
    outcome: 'succeeded',
    continuationReason: null,
    resumable: false,
    tone: 'success',
    messageKey: 'sys.done',
  })
})

test('max turns presents an incomplete resumable task', () => {
  const result = normalizeTaskResult({
    subtype: 'error_max_turns',
    outcome: 'incomplete',
    continuationReason: 'max_turns',
    resumable: true,
  })
  assert.equal(result.tone, 'warning')
  assert.equal(result.messageKey, 'sys.incompleteMaxTurns')
  assert.equal(result.resumable, true)
})

test('execution failure is not presented as success', () => {
  const result = normalizeTaskResult({subtype: 'error_during_execution', is_error: true, resumable: true})
  assert.equal(result.outcome, 'failed')
  assert.equal(result.tone, 'error')
  assert.equal(result.messageKey, 'sys.executionFailed')
})

test('continuation prompt includes original goal and remaining verification', () => {
  const prompt = buildContinuationPrompt({
    originalTask: '为当前项目增加按钮并完成验证',
    reason: 'max_turns',
  })
  assert.match(prompt, /继续执行同一个未完成任务/)
  assert.match(prompt, /为当前项目增加按钮并完成验证/)
  assert.match(prompt, /构建、测试或运行验证/)
  assert.doesNotMatch(prompt, /^Continue from where you left off\.$/)
})
