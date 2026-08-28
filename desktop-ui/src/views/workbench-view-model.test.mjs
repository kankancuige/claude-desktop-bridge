import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {transformSync} from 'esbuild'

const source = readFileSync(new URL('./workbench-view-model.ts', import.meta.url), 'utf8')
const compiled = transformSync(source, {loader: 'ts', format: 'esm', platform: 'node', target: 'node20'}).code
const model = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const task = (status, overrides = {}) => ({projectKey: 'project-a', taskKey: `${status}-task`, taskId: `${status}-task`, status, updatedAt: 20, state: {coordinator: {agents: {a: {status: 'running', role: 'builder'}}, workflows: {w: {status: 'running'}}, blockerCodes: [], verification: {status: status === 'succeeded' ? 'passed' : 'pending'}, ...overrides}}})

test('Workbench summary aggregates task, agent, workflow and verification states', () => {
  const summary = model.summarizeWorkbench([task('running'), task('succeeded'), task('blocked', {blockerCodes: ['external']})])
  assert.deepEqual(summary, {total: 3, active: 1, blocked: 1, completed: 1, failed: 0, agentsRunning: 3, workflowsRunning: 3, verified: 1, lastUpdated: 20})
})

test('Workbench helpers preserve evidence and unknown statuses', () => {
  const item = task('mystery', {steps: [{stepId: 's1', phase: 'verify', role: 'reviewer', status: 'new'}]})
  assert.equal(model.taskIsBlocked(item), false)
  assert.equal(model.taskSteps(item)[0].status, 'new')
  assert.equal(model.taskDisplayName({...item, taskKey: 'abc:coordinator', taskId: undefined}), 'abc')
})

test('Workbench 任务事件时间线显示中文标题和具体状态描述', () => {
  assert.equal(model.taskEventLabel('task/accepted'), '任务已接收')
  assert.equal(model.taskEventSummary({eventType: 'task/state-changed', payload: {status: 'running', phase: 'implement'}}), '执行中 · 阶段：implement')
  assert.equal(model.taskEventSummary({eventType: 'task/created', payload: {summary: '建立任务详情页'}}), '建立任务详情页')
  assert.equal(model.taskEventSummary({eventType: 'phase/started', payload: {phase: 'validate', stepId: 'step-2', role: 'test-engineer'}}), '阶段：validate · 步骤：step-2 · 角色：test-engineer')
})

test('Workbench 任务名称优先使用元数据，不把 UUID 作为可见标题', () => {
  assert.equal(model.taskDisplayName({...task('running'), title: '修复登录', summary: '摘要'}), '修复登录')
  assert.equal(model.taskDisplayName({...task('running'), title: '', summary: '摘要'}), '摘要')
  assert.equal(model.taskDisplayName({...task('running'), title: '未命名任务', summary: '修复任务列表标题'}), '修复任务列表标题')
  assert.equal(model.taskDisplayName({...task('running'), taskId: '550e8400-e29b-41d4-a716-446655440000', taskKey: undefined}), '未命名任务')
})

test('Workbench 详情读取使用项目和任务 ID 查询 DTO', async () => {
  const calls = []
  const result = await model.loadWorkbenchTaskDetail({projectKey: 'p', taskId: 't:1', fetcher: async input => { calls.push(input); return new Response(JSON.stringify({task: {taskId: 't:1'}, events: [], agents: {}, workflows: {}, verification: null, report: null, sessionLink: null}), {status: 200}) }})
  assert.equal(result.task.taskId, 't:1')
  assert.match(calls[0], /projectKey=p/)
})

test('Workbench removes legacy/coordinator duplicate projections and prefers coordinator state', () => {
  const legacy = task('running')
  const coordinator = {...legacy, taskKey: `${legacy.taskId}:coordinator`, state: {...legacy.state, coordinator: {phase: 'running', steps: [{stepId: 's1', status: 'running'}]}}}
  const result = model.dedupeTasks([legacy, coordinator])
  assert.equal(result.length, 1)
  assert.equal(result[0].taskKey.endsWith(':coordinator'), true)
})

test('Workbench 按 Agent 聚合名称、目的、目标和结果摘要', () => {
  const first = task('running', {agents: {
    run1: {name: '后端 Agent', agentType: 'backend-developer', role: 'developer', purpose: '实现 Gateway 接口', goal: '补齐任务查询', status: 'completed', resultSummary: '接口和测试已完成', changedFileCount: 2, testCount: 3, updatedAt: 30},
  }})
  const second = {...task('succeeded'), projectKey: 'project-b', sessionId: 's-2', state: {coordinator: {agents: {run2: {name: '验证 Agent', role: 'test-engineer', status: 'running'}}, workflows: {}, blockerCodes: [], verification: null}}}
  const agents = model.workbenchAgents([first, second])
  assert.equal(agents.length, 2)
  assert.equal(agents[0].name, '后端 Agent')
  assert.equal(agents[0].purpose, '实现 Gateway 接口')
  assert.equal(agents[0].resultSummary, '接口和测试已完成')
  assert.equal(agents[1].name, '验证 Agent')
})

test('Workbench 按项目和会话聚合任务，并按最新任务显示状态', () => {
  const first = {...task('running'), sessionId: 'session-1', updatedAt: 10}
  const second = {...task('succeeded'), taskKey: 'new-task', taskId: 'new-task', sessionId: 'session-1', updatedAt: 30}
  const sessions = model.workbenchSessions([first, second])
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].taskCount, 2)
  assert.equal(sessions[0].status, 'succeeded')
  assert.equal(sessions[0].sessionId, 'session-1')
})
