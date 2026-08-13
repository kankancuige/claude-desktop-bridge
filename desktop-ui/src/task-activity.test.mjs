import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./task-activity.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {createTaskActivityState, reduceTaskActivity, taskActivityFreshness} = await import(moduleUrl)

test('任务事件按启动、思考、工具、回复和审查阶段更新具体活动', () => {
  let state = createTaskActivityState()
  state = reduceTaskActivity(state, {type: 'task_started'}, 100)
  assert.equal(state.phase, 'starting')
  assert.equal(state.startedAt, 100)

  const restoredStart = reduceTaskActivity(createTaskActivityState(), {type: 'task_started', startedAt: 50}, 100)
  assert.equal(restoredStart.startedAt, 50)

  state = reduceTaskActivity(state, {type: 'thinking_start'}, 200)
  assert.equal(state.title, '正在分析任务')

  state = reduceTaskActivity(state, {type: 'thinking_delta', thinking: '先定位入口，再检查事件流'}, 220)
  assert.equal(state.detail, '先定位入口，再检查事件流')

  state = reduceTaskActivity(state, {type: 'tool_use_start', tool_name: 'Read', input: {file_path: 'src/main.ts'}}, 300)
  assert.equal(state.title, '正在使用 Read')
  assert.equal(state.detail, 'src/main.ts')

  state = reduceTaskActivity(state, {type: 'text_delta'}, 400)
  assert.equal(state.phase, 'responding')

  state = reduceTaskActivity(state, {type: 'task_reviewing', detail: '检查改动'}, 500)
  assert.equal(state.phase, 'reviewing')
  assert.equal(state.running, true)
})

test('Agent、上下文压缩、权限等待和修复阶段都有明确状态', () => {
  let state = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 100)
  state = reduceTaskActivity(state, {type: 'subagent_start', agentType: 'Explore', task: '扫描代码结构'}, 200)
  assert.equal(state.title, 'Agent Explore 正在执行')
  assert.equal(state.detail, '扫描代码结构')

  state = reduceTaskActivity(state, {type: 'subagent_progress', agentType: 'Explore', progress: '正在读取入口文件'}, 250)
  assert.equal(state.detail, '正在读取入口文件')

  state = reduceTaskActivity(state, {type: 'context_compacting', trigger: 'auto'}, 300)
  assert.equal(state.phase, 'compacting')

  state = reduceTaskActivity(state, {type: 'permission_request', summary: '执行构建'}, 400)
  assert.equal(state.phase, 'waiting')

  state = reduceTaskActivity(state, {type: 'task_fixing', detail: '修复审查问题'}, 500)
  assert.equal(state.phase, 'fixing')

  state = reduceTaskActivity(state, {type: 'tool_progress', tool_name: 'Read', elapsed_time_seconds: 12}, 600)
  assert.equal(state.detail, '已执行 12 秒')

  state = reduceTaskActivity(state, {type: 'workflow_phase', phase: '最终审查'}, 700)
  assert.equal(state.title, '正在执行工作流阶段')
  assert.equal(state.detail, '最终审查')
})

test('完成、失败和停止会结束运行状态', () => {
  const running = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 100)
  assert.equal(reduceTaskActivity(running, {type: 'task_completed'}, 200).running, false)
  assert.equal(reduceTaskActivity(running, {type: 'stream_error', message: 'network'}, 200).phase, 'failed')
  assert.equal(reduceTaskActivity(running, {type: 'generation_stopped'}, 200).phase, 'stopped')
})

test('执行中追加桌面或 IM 指令不会重置任务开始时间', () => {
  const running = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 100)
  const continued = reduceTaskActivity(running, {type: 'task_input_added', source: '微信'}, 500)
  assert.equal(continued.startedAt, 100)
  assert.equal(continued.updatedAt, 500)
  assert.equal(continued.title, '已注入补充指令，继续执行')
  assert.equal(continued.detail, '微信')
})

test('长时间没有执行事件时分级提示等待和可能卡住', () => {
  const state = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 1000)
  assert.equal(taskActivityFreshness(state, 30_000).level, 'active')
  assert.equal(taskActivityFreshness(state, 70_000).level, 'waiting')
  assert.equal(taskActivityFreshness(state, 200_000).level, 'stale')
})
