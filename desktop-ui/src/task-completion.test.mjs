import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./task-completion.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {createParentTaskUiState, reduceParentTaskUi} = await import(moduleUrl)

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
