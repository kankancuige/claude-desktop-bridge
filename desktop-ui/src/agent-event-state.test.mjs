import test from 'node:test'
import assert from 'node:assert/strict'
import {mergeWorkflowAgentLogState, normalizeWorkflowLogAgentStatus} from './agent-event-state.mjs'

test('旧日志 pending 映射为内联卡片支持的 spawning', () => {
  assert.equal(normalizeWorkflowLogAgentStatus('pending'), 'spawning')
})

test('结构化运行事件不被旧日志中的完成文字提前覆盖', () => {
  const state = mergeWorkflowAgentLogState({status: 'running', eventSource: 'structured'}, 'done')
  assert.equal(state.status, 'running')
  assert.equal(state.eventSource, 'structured')
})

test('没有结构化事件的旧 Gateway 仍可由日志推进 Agent 状态', () => {
  const state = mergeWorkflowAgentLogState({status: 'running', eventSource: 'log'}, 'done')
  assert.equal(state.status, 'done')
  assert.equal(state.eventSource, 'log')
})
