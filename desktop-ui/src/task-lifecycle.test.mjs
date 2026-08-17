import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./task-lifecycle.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {createSessionLifecycleState, reduceSessionLifecycle} = await import(moduleUrl)

test('权威快照统一决定忙碌和操作能力', () => {
  const state = reduceSessionLifecycle(createSessionLifecycleState(), {
    type: 'session_lifecycle_snapshot',
    active: true,
    sequence: 4,
    capabilities: {canSend: false, canStop: true, canContinue: false},
  })
  assert.deepEqual(state, {
    version: 1, received: true, active: true, sequence: 4,
    canSend: false, canStop: true, canContinue: false, awaitingAcceptance: false,
  })
})

test('SDK result 和单个 Workflow 完成不能自行结束父任务', () => {
  const running = reduceSessionLifecycle(createSessionLifecycleState(), {type: 'task_started'})
  assert.equal(reduceSessionLifecycle(running, {type: 'result'}).active, true)
  assert.equal(reduceSessionLifecycle(running, {type: 'workflow_done'}).active, true)
})

test('旧协议下父任务终态或停止事件解除忙碌', () => {
  const running = createSessionLifecycleState({active: true, canSend: false, canStop: true})
  assert.equal(reduceSessionLifecycle(running, {type: 'task_completed'}).active, false)
  assert.equal(reduceSessionLifecycle(running, {type: 'task_failed', taskState: {resumable: true}}).canContinue, true)
  assert.equal(reduceSessionLifecycle(running, {type: 'generation_stopped'}).canStop, false)
})

test('权威模式等待聚合快照解除忙碌，终态展示事件不能抢先释放队列', () => {
  const running = reduceSessionLifecycle(createSessionLifecycleState(), {
    type: 'session_lifecycle_snapshot', active: true,
    capabilities: {canSend: false, canStop: true, canContinue: false},
  })
  assert.equal(reduceSessionLifecycle(running, {type: 'task_completed'}).active, true)
  const terminal = reduceSessionLifecycle(running, {
    type: 'session_lifecycle_snapshot', active: false,
    capabilities: {canSend: true, canStop: false, canContinue: false},
  })
  assert.equal(terminal.active, false)
})

test('Gateway 拒绝本地乐观发送时立即恢复可发送状态', () => {
  const optimistic = reduceSessionLifecycle(createSessionLifecycleState({received: true}), {type: 'local_task_submitted'})
  const rejected = reduceSessionLifecycle(optimistic, {type: 'message_rejected'})
  assert.equal(rejected.active, false)
  assert.equal(rejected.canSend, true)
})

test('流式响应中断携带终态 taskState 时立即释放 busy 状态', () => {
  const running = reduceSessionLifecycle(createSessionLifecycleState({
    received: true, active: true, canSend: false, canStop: true,
  }), {type: 'task_started'})
  const failed = reduceSessionLifecycle(running, {
    type: 'error',
    message: 'Connection closed mid-response',
    taskState: {status: 'interrupted', resumable: true},
  })
  assert.equal(failed.active, false)
  assert.equal(failed.canSend, true)
  assert.equal(failed.canStop, false)
  assert.equal(failed.canContinue, true)
})

test('错误事件携带成功终态时不能重新显示继续执行', () => {
  const running = reduceSessionLifecycle(createSessionLifecycleState({
    received: true, active: true, canSend: false, canStop: true,
  }), {type: 'task_started'})
  const completed = reduceSessionLifecycle(running, {
    type: 'stream_error',
    message: 'Connection closed mid-response',
    taskState: {status: 'succeeded', resumable: false},
  })
  assert.equal(completed.active, false)
  assert.equal(completed.canSend, true)
  assert.equal(completed.canContinue, false)
})

test('执行中补充指令被拒绝不能解除真实父任务忙碌', () => {
  const running = reduceSessionLifecycle(createSessionLifecycleState({received: true}), {type: 'task_started'})
  const supplemental = reduceSessionLifecycle(running, {type: 'local_task_submitted'})
  assert.equal(supplemental.awaitingAcceptance, false)
  assert.equal(reduceSessionLifecycle(supplemental, {type: 'message_rejected'}).active, true)
})
