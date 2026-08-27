import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./task-activity.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {createTaskActivityState, reduceTaskActivity, reconcileTaskActivitySnapshot, taskActivityFreshness, isReviewLifecycleEvent} = await import(moduleUrl)

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
  assert.equal(state.title, '正在读取文件')
  assert.equal(state.entries.find(entry => entry.id === 'thinking:thought_1').status, 'completed')
  assert.equal(state.entries.find(entry => entry.id === 'tool:tool_1').detail, 'src/main.ts')

  state = reduceTaskActivity(state, {type: 'tool_progress', tool_name: 'Read', tool_use_id: 'tool_1', elapsed_time_seconds: 12}, 400)
  assert.equal(state.entries.find(entry => entry.id === 'tool:tool_1').durationMs, 12_000)
  state = reduceTaskActivity(state, {
    type: 'tool_input_update', tool_name: 'Read', tool_use_id: 'tool_1', input: {file_path: 'src/main.ts'},
  }, 450)
  assert.equal(state.title, '正在读取文件')
  assert.equal(state.entries.find(entry => entry.id === 'tool:tool_1').detail, 'src/main.ts')
  assert.equal(state.entries.filter(entry => entry.id === 'tool:tool_1').length, 1)

  state = reduceTaskActivity(state, {type: 'content_block_stop', index: 'tool_1'}, 500)
  assert.equal(state.entries.find(entry => entry.id === 'tool:tool_1').status, 'completed')

  state = reduceTaskActivity(state, {type: 'text_delta'}, 600)
  state = reduceTaskActivity(state, {type: 'task_reviewing', detail: '检查改动'}, 700)
  assert.equal(state.phase, 'reviewing')
  assert.equal(state.entries.at(-1).title, '正在进行定向审查')
})

test('Light 主回复完成不会伪装成定向审查', () => {
  let state = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 100)
  state = reduceTaskActivity(state, {type: 'text_delta'}, 200)
  state = reduceTaskActivity(state, {type: 'primary_completed', primaryOutcome: 'succeeded'}, 300)

  assert.equal(state.phase, 'responding')
  assert.equal(state.entries.some(entry => entry.id === 'task:review'), false)
  assert.equal(isReviewLifecycleEvent('primary_completed'), false)
  assert.equal(isReviewLifecycleEvent('task_reviewing'), true)
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
  state = reduceTaskActivity(state, {
    type: 'confirmation_resolved', requestId: 'p1', confirmationType: 'permission', toolName: 'Bash', wonBy: 'auto',
  }, 550)
  assert.equal(state.entries.find(entry => entry.id === 'waiting:p1').status, 'completed')
  assert.equal(state.phase, 'tool')
  assert.equal(state.title, '权限已自动允许，正在运行命令')
  assert.equal(state.detail, '已切换为全部自动')
})

test('确认结算只关闭对应的等待步骤，不误关闭并发确认', () => {
  let state = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 100)
  state = reduceTaskActivity(state, {type: 'permission_request', requestId: 'p1', toolName: 'Read'}, 200)
  state = reduceTaskActivity(state, {type: 'choice_request', requestId: 'c1', question: '选择方案'}, 300)
  state = reduceTaskActivity(state, {
    type: 'confirmation_resolved', requestId: 'p1', confirmationType: 'permission', toolName: 'Read', wonBy: 'desktop',
  }, 400)

  assert.equal(state.entries.find(entry => entry.id === 'waiting:p1').status, 'completed')
  assert.equal(state.entries.find(entry => entry.id === 'waiting:c1').status, 'waiting')
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
  for (const [type, phase] of [['task_completed', 'completed'], ['task_verification_inconclusive', 'failed'], ['stream_error', 'failed'], ['generation_stopped', 'stopped']]) {
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

test('Provider 等待心跳在无 SDK 事件时保持可见进度', () => {
  let state = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 100)
  state = reduceTaskActivity(state, {type: 'stream_waiting', waitingFor: 'provider', elapsedMs: 15_000, message: '正在等待 Provider 返回首个事件'}, 15_100)
  assert.equal(state.phase, 'waiting')
  assert.equal(state.running, true)
  assert.equal(state.title, '正在等待 Provider 返回')
  assert.equal(state.entries.find(entry => entry.id === 'waiting:stream').status, 'waiting')
  assert.equal(taskActivityFreshness(state, 15_101).level, 'active')
})

test('自动工作流与暂停终态在前端形成明确可见状态', () => {
  let state = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 100)
  state = reduceTaskActivity(state, {type: 'workflow_auto_started', workflowId: 'wf1', name: '最终审查', task: '检查改动'}, 200)
  assert.equal(state.running, true)
  assert.equal(state.title, '已自动启动 最终审查')
  assert.equal(state.entries.find(entry => entry.id === 'workflow:auto:wf1').status, 'running')
  state = reduceTaskActivity(state, {type: 'workflow_paused', workflowId: 'wf1'}, 300)
  assert.equal(state.running, false)
  assert.equal(state.phase, 'waiting')
  assert.equal(state.title, '工作流已暂停，等待恢复')
})

test('重连收到终态快照时会收口旧的 Provider 等待状态', () => {
  let state = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 100)
  state = reduceTaskActivity(state, {type: 'stream_waiting', waitingFor: 'provider'}, 200)
  const reconciled = reconcileTaskActivitySnapshot(state, {
    generating: false,
    pendingConfirmations: [],
    taskState: {status: 'failed', detail: '上游请求超时', resumable: true},
  }, 300)
  assert.equal(reconciled.running, false)
  assert.equal(reconciled.phase, 'failed')
  assert.equal(reconciled.entries.some(entry => entry.status === 'waiting'), false)
})

test('重连收到 idle 快照时会清除没有真实任务的旧等待状态', () => {
  let state = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 100)
  state = reduceTaskActivity(state, {type: 'stream_waiting', waitingFor: 'provider'}, 200)
  const reconciled = reconcileTaskActivitySnapshot(state, {generating: false, taskState: {status: 'idle'}}, 300)
  assert.equal(reconciled.running, false)
  assert.equal(reconciled.entries.length, 0)
})

test('持久化 running 但 live generating=false 时不会恢复旧 Provider 等待', () => {
  let state = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 100)
  state = reduceTaskActivity(state, {type: 'stream_waiting', waitingFor: 'provider'}, 200)
  const reconciled = reconcileTaskActivitySnapshot(state, {generating: false, taskState: {status: 'running'}}, 300)
  assert.equal(reconciled.running, false)
})

test('任务终态优先于清理阶段残留的 generating 标志', () => {
  let state = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 100)
  state = reduceTaskActivity(state, {type: 'stream_waiting', waitingFor: 'provider'}, 200)
  const reconciled = reconcileTaskActivitySnapshot(state, {
    generating: true,
    taskState: {status: 'succeeded', detail: '已完成'},
  }, 300)
  assert.equal(reconciled.running, false)
  assert.equal(reconciled.phase, 'completed')
})

test('重连快照含写入委托时恢复等待主任务写入提示且不依赖实时事件', () => {
  const reconciled = reconcileTaskActivitySnapshot(createTaskActivityState(), {
    generating: false,
    taskState: {
      status: 'incomplete',
      continuationReason: 'write_permission_required',
      detail: '只读 Agent 请求主任务修改文件',
      writeRequests: [{
        agentRunId: 'review-1',
        writeRequest: {requestedFiles: ['gateway/agent.mjs']},
      }],
    },
  }, 300)
  assert.equal(reconciled.phase, 'waiting')
  assert.equal(reconciled.running, true)
  assert.equal(reconciled.entries.filter(entry => entry.id.startsWith('waiting:')).length, 1)
  assert.match(reconciled.detail, /只读 Agent 请求主任务修改文件/)
})

test('达到单段轮数上限后自动续跑仍保持同一父任务运行', () => {
  let state = reduceTaskActivity(createTaskActivityState(), {type: 'task_started'}, 1_000)
  state = reduceTaskActivity(state, {
    type: 'task_auto_continuing', attempt: 2, maxAttempts: 3, tier: 'power', completedTurns: 80,
  }, 2_000)
  assert.equal(state.running, true)
  assert.equal(state.phase, 'starting')
  assert.equal(state.startedAt, 1_000)
  assert.equal(state.title, '已达到单段轮数上限，正在自动续跑')
  assert.match(state.entries.at(-1).detail, /第 2\/3 次/)
  assert.match(state.entries.at(-1).detail, /累计 80 轮/)
})

test('Coordinator 阶段、角色、验证证据和阻塞形成独立步骤', () => {
  let state = reduceTaskActivity(createTaskActivityState(), {
    type: 'task_coordinator_event', taskId: 't', event: 'phase/started', phase: 'validate',
    stepId: 's2', role: 'test-engineer', status: 'verifying', verification: {evidenceLevel: 'L2'},
  }, 100)
  assert.equal(state.phase, 'verifying')
  assert.equal(state.entries[0].kind, 'verification')
  assert.match(state.entries[0].detail, /test-engineer/)
  assert.match(state.entries[0].detail, /L2/)
  state = reduceTaskActivity(state, {
    type: 'task_coordinator_event', taskId: 't', event: 'task/blocked', status: 'blocked', detail: '缺少运行环境',
  }, 200)
  assert.equal(state.running, false)
  assert.equal(state.entries.at(-1).status, 'failed')
})

test('Coordinator 等待用户时停止忙碌态并保留可见等待步骤', () => {
  const state = reduceTaskActivity(createTaskActivityState(), {
    type: 'task_coordinator_event', event: 'task/waiting-user', phase: 'validate',
    status: 'waiting_user', detail: '请确认验证环境', stepId: 'wait-1',
  }, 100)
  assert.equal(state.running, false)
  assert.equal(state.phase, 'waiting')
  assert.equal(state.entries.at(-1).status, 'waiting')
  assert.equal(state.title, '等待用户处理')
})

test('只读 Agent 写入委托显示为等待主任务处理而非失败', () => {
  const state = reduceTaskActivity(createTaskActivityState(), {
    type: 'task_write_delegated',
    requests: [{writeRequest: {requestedFiles: ['gateway/a.mjs']}}],
  }, 100)
  assert.equal(state.phase, 'waiting')
  assert.equal(state.running, true)
  assert.match(state.title, /主任务执行 Agent 写入/)
  assert.match(state.detail, /gateway\/a\.mjs/)
})
