import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./task-activity.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {createTaskActivityState, reduceTaskActivity, taskActivityFreshness} = await import(moduleUrl)

test('任务事件按开始、思考、工具、回复和审查阶段更新活动状态', () => {
  let state = createTaskActivityState()
  state = reduceTaskActivity(state, {type: 'task_started'}, 100)
  assert.equal(state.phase, 'starting')
  assert.equal(state.startedAt, 100)
  assert.equal(state.entries[0].title, '任务已接收')

  state = reduceTaskActivity(state, {type: 'thinking_start', index: 'thought_1'}, 200)
  state = reduceTaskActivity(state, {type: 'thinking_delta', index: 'thought_1', thinking: '先定位入口，再检查事件流'}, 220)
  assert.equal(state.detail, '先定位入口，再检查事件流')
  assert.equal(state.entries.filter(entry => entry.kind === 'thinking').length, 1)

  state = reduceTaskActivity(state, {type: 'tool_use_start', tool_name: 'Read', tool_use_id: 'tool_1', input: {file_path: 'src/main.ts'}}, 300)
  assert.equal(state.title, '正在使用 Read')
  assert.equal(state.entries.find(entry => entry.id === 'thinking:thought_1').status, 'completed')
  assert.equal(state.entries.find(entry => entry.id === 'tool:tool_1').detail, 'src/main.ts')

  state = reduceTaskActivity(state, {type: 'tool_progress', tool_name: 'Read', tool_use_id: 'tool_1', elapsed_time_seconds: 12}, 400)
  assert.equal(state.entries.find(entry => entry.id === 'tool:tool_1').durationMs, 12_000)
  assert.equal(state.entries.filter(entry => entry.id === 'tool:tool_1').length, 1)

  state = reduceTaskActivity(state, {type: 'content_block_stop', index: 'tool_1'}, 500)
  assert.equal(state.entries.find(entry => entry.id === 'tool:tool_1').status, 'completed')

  state = reduceTaskActivity(state, {type: 'text_delta'}, 600)
  state = reduceTaskActivity(state, {type: 'task_reviewing', detail: '检查改动'}, 700)
  assert.equal(state.phase, 'reviewing')
  assert.equal(state.entries.at(-1).title, '正在进行定向审查')
})

test('Agent、工作流、上下文压缩和权限等待形成可更新步骤', () => {
  let state = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 100)
  state = reduceTaskActivity(state, {type: 'subagent_start', id: 'a1', agentType: 'Explore', task: '扫描代码结构'}, 200)
  state = reduceTaskActivity(state, {type: 'subagent_progress', id: 'a1', agentType: 'Explore', progress: '正在读取入口文件'}, 250)
  assert.equal(state.entries.find(entry => entry.id === 'agent:a1').detail, '正在读取入口文件')

  state = reduceTaskActivity(state, {type: 'workflow_started', workflowId: 'wf1', name: '定向验证'}, 300)
  state = reduceTaskActivity(state, {type: 'workflow_phase', workflowId: 'wf1', phase: '运行测试'}, 350)
  assert.equal(state.entries.at(-1).title, '运行测试')

  state = reduceTaskActivity(state, {type: 'context_compacting', trigger: 'auto'}, 400)
  state = reduceTaskActivity(state, {type: 'context_compacted'}, 450)
  assert.equal(state.entries.find(entry => entry.id === 'context:compaction').status, 'completed')

  state = reduceTaskActivity(state, {type: 'permission_request', requestId: 'p1', summary: '执行构建'}, 500)
  assert.equal(state.entries.at(-1).status, 'waiting')
  state = reduceTaskActivity(state, {type: 'confirmation_resolved', requestId: 'p1'}, 550)
  assert.equal(state.entries.find(entry => entry.id === 'waiting:p1').status, 'completed')
})

test('工具摘要会截断并脱敏凭据', () => {
  let state = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 100)
  state = reduceTaskActivity(state, {
    type: 'tool_use_start', tool_name: 'Bash', tool_use_id: 'secret',
    input: {command: 'curl -H "Authorization: Bearer abcdefghijklmnop" https://user:pass@example.test ' + 'x'.repeat(300)},
  }, 200)
  const detail = state.entries.find(entry => entry.id === 'tool:secret').detail
  assert.equal(detail.includes('abcdefghijklmnop'), false)
  assert.equal(detail.includes('user:pass@'), false)
  assert.equal(detail.length <= 200, true)
})

test('完成、失败和停止会关闭所有运行步骤并记录总耗时', () => {
  for (const [type, phase] of [['task_completed', 'completed'], ['stream_error', 'failed'], ['generation_stopped', 'stopped']]) {
    let state = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 100)
    state = reduceTaskActivity(state, {type: 'tool_use_start', tool_name: 'Read', tool_use_id: 't1'}, 150)
    state = reduceTaskActivity(state, {type, message: '终态'}, 500)
    assert.equal(state.phase, phase)
    assert.equal(state.running, false)
    assert.equal(state.entries.some(entry => ['running', 'waiting'].includes(entry.status)), false)
    assert.equal(state.entries.at(-1).durationMs, 400)
  }
})

test('终态之后迟到事件不能重新激活，但明确新任务和恢复可以', () => {
  const running = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 100)
  const completed = reduceTaskActivity(running, {type: 'task_completed'}, 200)
  assert.equal(reduceTaskActivity(completed, {type: 'workflow_log', message: '迟到日志'}, 300).phase, 'completed')
  assert.equal(reduceTaskActivity(completed, {type: 'subagent_done', id: 'a1'}, 400).running, false)

  const nextTask = reduceTaskActivity(completed, {type: 'task_started'}, 500)
  assert.equal(nextTask.running, true)
  assert.equal(nextTask.startedAt, 500)

  const resumed = reduceTaskActivity(completed, {type: 'workflow_resumed', workflowId: 'wf1', name: '审查'}, 600)
  assert.equal(resumed.running, true)
})

test('补充指令不重置任务开始时间，长时间无事件分级提示', () => {
  const running = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 1_000)
  const continued = reduceTaskActivity(running, {type: 'task_input_added', source: '微信'}, 5_000)
  assert.equal(continued.startedAt, 1_000)
  assert.equal(continued.detail, '微信')
  assert.equal(taskActivityFreshness(continued, 30_000).level, 'active')
  assert.equal(taskActivityFreshness(continued, 70_000).level, 'waiting')
  assert.equal(taskActivityFreshness(continued, 200_000).level, 'stale')
})
