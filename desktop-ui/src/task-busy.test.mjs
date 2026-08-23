import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./task-busy.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {isTaskBusy} = await import(moduleUrl)

test('主回合或活动事件运行时保持忙碌', () => {
  assert.equal(isTaskBusy({status: 'thinking'}), true)
  assert.equal(isTaskBusy({activityRunning: true}), true)
  assert.equal(isTaskBusy({runningAgentTotal: 1}), true)
})

test('主回合已结束但最终审查或 Workflow 运行时仍保持忙碌', () => {
  assert.equal(isTaskBusy({status: 'idle', parentPhase: 'reviewing'}), true)
  assert.equal(isTaskBusy({status: 'idle', workflowStatus: 'running'}), true)
  assert.equal(isTaskBusy({status: 'idle', flushingQueue: true}), true)
})

test('所有任务和队列终态才允许发送新主消息', () => {
  assert.equal(isTaskBusy({status: 'idle', workflowStatus: 'done', parentPhase: 'succeeded'}), false)
  assert.equal(isTaskBusy({status: 'idle', workflowStatus: 'error', parentPhase: 'failed'}), false)
})

test('收到权威生命周期后不再被迟到的展示状态反向判忙', () => {
  assert.equal(isTaskBusy({
    lifecycleReceived: true,
    lifecycleActive: false,
    status: 'thinking',
    activityRunning: true,
    runningAgentTotal: 1,
  }), false)
  assert.equal(isTaskBusy({lifecycleReceived: true, lifecycleActive: true, status: 'idle'}), true)
})

test('父任务终态覆盖迟到的 active 快照，但运行中的 Workflow 仍保持忙碌', () => {
  assert.equal(isTaskBusy({
    lifecycleReceived: true,
    lifecycleActive: true,
    parentPhase: 'succeeded',
    workflowStatus: 'done',
  }), false)
  assert.equal(isTaskBusy({
    lifecycleReceived: true,
    lifecycleActive: true,
    parentPhase: 'succeeded',
    workflowStatus: 'running',
  }), true)
  assert.equal(isTaskBusy({
    lifecycleReceived: true,
    lifecycleActive: true,
    taskStatus: 'succeeded',
    workflowStatus: 'done',
  }), false)
  assert.equal(isTaskBusy({status: 'thinking', activityRunning: true, taskStatus: 'incomplete'}), false)
})
