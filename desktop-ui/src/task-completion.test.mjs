import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./task-completion.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {
  createParentTaskUiState,
  mergeParentTaskSnapshot,
  reduceParentTaskUi,
  normalizeAssistantText,
  removeSupersededAssistantMessages,
  selectSucceededTaskSummary,
  shouldShowPendingResultForTerminal,
} = await import(moduleUrl)

test('终态快照不会抢先吞掉尚未抵达的最终总结事件', () => {
  const pending = mergeParentTaskSnapshot(createParentTaskUiState({phase: 'running', taskId: 'task-1'}), {
    status: 'succeeded', taskId: 'task-1', sequence: 8,
  })
  assert.equal(pending.phase, 'succeeded')
  assert.equal(pending.completionShown, false)

  const shown = mergeParentTaskSnapshot(createParentTaskUiState({phase: 'succeeded', taskId: 'task-1', completionShown: true}), {
    status: 'succeeded', taskId: 'task-1', sequence: 9,
  })
  assert.equal(shown.completionShown, true)
})

test('SDK result only settles primary turn statistics', () => {
  const reduced = reduceParentTaskUi(createParentTaskUiState({phase: 'running'}), {type: 'result'})
  assert.equal(reduced.state.phase, 'running')
  assert.equal(reduced.state.primaryResultSeen, true)
  assert.equal(reduced.showCompletion, false)
})

test('reviewing and fixing never show completion', () => {
  let state = reduceParentTaskUi(createParentTaskUiState({phase: 'running'}), {type: 'task_reviewing'}).state
  assert.equal(state.phase, 'reviewing')
  let reduced = reduceParentTaskUi(state, {type: 'task_fixing', detail: '正在修复'})
  assert.equal(reduced.state.phase, 'fixing')
  assert.equal(reduced.showCompletion, false)
})

test('task_completed shows success exactly once', () => {
  const first = reduceParentTaskUi(createParentTaskUiState({phase: 'reviewing'}), {type: 'task_completed'})
  assert.equal(first.state.phase, 'succeeded')
  assert.equal(first.showCompletion, true)
  const duplicate = reduceParentTaskUi(first.state, {type: 'task_completed'})
  assert.equal(duplicate.showCompletion, false)
})

test('验证不足保持未完成且不显示成功', () => {
  const reduced = reduceParentTaskUi(createParentTaskUiState({phase: 'running'}), {type: 'task_verification_inconclusive'})
  assert.equal(reduced.state.phase, 'incomplete')
  assert.equal(reduced.showCompletion, false)
})

test('父任务事件按 taskId 和 sequence 丢弃重复与乱序更新', () => {
  const started = reduceParentTaskUi(createParentTaskUiState(), {type: 'task_started', taskId: 'task-1', sequence: 1}).state
  const reviewing = reduceParentTaskUi(started, {type: 'task_reviewing', taskId: 'task-1', sequence: 3}).state
  assert.equal(reviewing.phase, 'reviewing')
  const stale = reduceParentTaskUi(reviewing, {type: 'primary_completed', taskId: 'task-1', sequence: 2})
  assert.equal(stale.state.phase, 'reviewing')
  assert.equal(stale.state.sequence, 3)
  const nextTask = reduceParentTaskUi(reviewing, {type: 'task_started', taskId: 'task-2', sequence: 1}).state
  assert.equal(nextTask.phase, 'running')
  assert.equal(nextTask.completionShown, false)
})

test('成功终态只选择 Gateway 的最终总结，不回填 SDK result 的中间状态消息', () => {
  assert.equal(selectSucceededTaskSummary({
    reply: '  已完成：修复空白气泡并通过测试  ',
    finalReplyText: '旧的持久化总结',
  }), '已完成：修复空白气泡并通过测试')
  assert.equal(selectSucceededTaskSummary({
    reply: '   ',
    finalReplyText: '  从持久化任务状态恢复的最终总结  ',
  }), '从持久化任务状态恢复的最终总结')
  assert.equal(selectSucceededTaskSummary({reply: '\n\t', finalReplyText: ''}), '')
})

test('空白或非文本 assistant 内容不会创建可见 AI 气泡', () => {
  assert.equal(normalizeAssistantText('  \n\t '), '')
  assert.equal(normalizeAssistantText(null), '')
  assert.equal(normalizeAssistantText('  有效回复  '), '有效回复')
})

test('Coordinator 最终总结覆盖同正文的 SDK assistant 气泡', () => {
  const visible = removeSupersededAssistantMessages([
    {role: 'assistant', text: '最终总结'},
    {role: 'user', text: '上一轮也要求总结'},
    {role: 'assistant', text: '最终总结'},
    {role: 'system', text: '任务已完成'},
    {role: 'user', text: '本轮任务'},
    {role: 'assistant', text: '最终总结'},
    {role: 'assistant', text: '最终总结', taskResult: {outcome: 'succeeded'}},
  ])
  assert.deepEqual(visible.map(item => item.role), ['assistant', 'user', 'assistant', 'system', 'user', 'assistant'])
  assert.equal(visible.at(-1).taskResult.outcome, 'succeeded')
})

test('Completion Gate 拒绝成功时不追加 SDK 的成功统计', () => {
  assert.equal(shouldShowPendingResultForTerminal({
    terminalType: 'task_verification_inconclusive', pendingOutcome: 'succeeded',
  }), false)
  assert.equal(shouldShowPendingResultForTerminal({
    terminalType: 'task_failed', pendingOutcome: 'succeeded',
  }), false)
  assert.equal(shouldShowPendingResultForTerminal({
    terminalType: 'task_failed', pendingOutcome: 'failed',
  }), true)
})
