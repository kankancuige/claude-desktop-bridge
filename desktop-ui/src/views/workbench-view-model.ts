export type WorkbenchTask = {
  projectKey?: string
  taskKey?: string
  taskId?: string
  title?: string
  summary?: string
  goal?: string
  requestText?: string
  source?: string
  sdkSessionId?: string | null
  historySessionId?: string | null
  turnId?: string | null
  sessionId?: string
  status?: string
  phase?: string
  updatedAt?: number
  startedAt?: number
  completedAt?: number
  context?: {profile?: string; estimatedInputTokens?: number; maxInputTokens?: number; selectedLayers?: string[]; omitted?: Array<{layer?: string; reason?: string}>} | null
  execution?: {
    mode?: 'session' | 'workflow' | 'mission' | string
    currentStepId?: string | null
    completedStepCount?: number
    totalStepCount?: number
    continuationCount?: number
    budget?: {maxRounds?: number; maxTokens?: number; maxDurationMs?: number; roundsUsed?: number; tokensUsed?: number; remaining?: {rounds?: number; tokens?: number; durationMs?: number} | null}
  } | null
  state?: {
    coordinator?: {
      phase?: string | null
      steps?: Array<{stepId?: string; phase?: string; role?: string; status?: string; required?: boolean}>
      agents?: Record<string, {role?: string; stepId?: string; status?: string}>
      workflows?: Record<string, {status?: string}>
      timeline?: Array<{type?: string; agentRunId?: string; agentType?: string; name?: string; stepId?: string; status?: string; summary?: string; at?: number}>
      verification?: {status?: string; evidenceLevel?: string; testsExecuted?: boolean} | null
      blockerCodes?: string[]
    } | null
  }
}

export type WorkbenchSessionLink = {
  projectKey: string
  encodedDir: string | null
  sessionId: string | null
  sdkSessionId?: string | null
  historySessionId?: string | null
  turnId?: string | null
  available: boolean
  reason?: string
}

export type WorkbenchTaskDetail = {
  task: WorkbenchTask
  events: Array<Record<string, any>>
  questions: WorkbenchQuestion[]
  agents: Record<string, any>
  workflows: Record<string, any>
  verification: any
  report: any
  sessionLink: WorkbenchSessionLink | null
}

export type WorkbenchQuestion = {
  questionId: string
  taskId: string
  sessionId?: string | null
  sdkSessionId?: string | null
  historySessionId?: string | null
  turnId?: string | null
  source?: string
  eventType?: string
  revision?: number
  createdAt?: number
  text: string
  summary?: string
  sessionLink?: WorkbenchSessionLink | null
}

export type WorkbenchData = {
  projectKeys: string[]
  tasks: WorkbenchTask[]
  reports: any[]
  pitfalls: any[]
  health: any | null
  driftCandidates: any[]
  stateStoreDegraded: boolean
}

export type WorkbenchSummary = {
  total: number
  active: number
  blocked: number
  completed: number
  failed: number
  agentsRunning: number
  workflowsRunning: number
  verified: number
  lastUpdated: number
}

export type WorkbenchAgent = {
  id: string
  name: string
  agentType: string
  role: string
  purpose: string
  goal: string
  status: string
  projectKey: string
  taskKey: string
  taskName: string
  stepId: string
  resultSummary: string
  changedFileCount: number
  testCount: number
  updatedAt: number
}

export type WorkbenchSession = {
  id: string
  sessionId: string
  projectKey: string
  status: string
  taskCount: number
  latestTaskName: string
  updatedAt: number
}

const ACTIVE_STATUSES = new Set(['running', 'reviewing', 'changes_required', 'fixing', 'accepted', 'dispatching'])
const BLOCKED_STATUSES = new Set(['blocked', 'review_paused', 'incomplete', 'interrupted'])
const COMPLETED_STATUSES = new Set(['succeeded', 'completed', 'done', 'success'])
const FAILED_STATUSES = new Set(['failed', 'error', 'regression_detected'])
const RUNNING_AGENT_STATUSES = new Set(['starting', 'running', 'spawning'])
const RUNNING_WORKFLOW_STATUSES = new Set(['starting', 'running', 'queued'])

function taskStatus(task: WorkbenchTask): string {
  return String(task.status || task.state?.coordinator?.phase || 'unknown').toLowerCase()
}

function values<T>(value: Record<string, T> | undefined | null): T[] {
  return Object.values(value || {})
}

export function summarizeWorkbench(tasks: WorkbenchTask[] = []): WorkbenchSummary {
  const summary: WorkbenchSummary = {total: tasks.length, active: 0, blocked: 0, completed: 0, failed: 0, agentsRunning: 0, workflowsRunning: 0, verified: 0, lastUpdated: 0}
  for (const task of tasks) {
    const status = taskStatus(task)
    if (ACTIVE_STATUSES.has(status)) summary.active += 1
    if (BLOCKED_STATUSES.has(status) || (task.state?.coordinator?.blockerCodes?.length || 0) > 0) summary.blocked += 1
    if (COMPLETED_STATUSES.has(status)) summary.completed += 1
    if (FAILED_STATUSES.has(status)) summary.failed += 1
    summary.agentsRunning += values(task.state?.coordinator?.agents).filter(agent => RUNNING_AGENT_STATUSES.has(String(agent.status || '').toLowerCase())).length
    summary.workflowsRunning += values(task.state?.coordinator?.workflows).filter(workflow => RUNNING_WORKFLOW_STATUSES.has(String(workflow.status || '').toLowerCase())).length
    if (['passed', 'verified', 'completed'].includes(String(task.state?.coordinator?.verification?.status || '').toLowerCase())) summary.verified += 1
    summary.lastUpdated = Math.max(summary.lastUpdated, Number(task.updatedAt || 0))
  }
  return summary
}

export function taskAgents(task: WorkbenchTask): Array<{id: string; name: string; agentType: string; role: string; purpose: string; goal: string; stepId: string; status: string; resultSummary: string; changedFileCount: number; testCount: number; startedAt: number; endedAt: number; updatedAt: number}> {
  return Object.entries(task.state?.coordinator?.agents || {}).map(([id, agent]) => ({
    id,
    name: String((agent as any).name || (agent as any).agentType || agent.role || 'Agent'),
    agentType: String((agent as any).agentType || agent.role || 'general-purpose'),
    role: String(agent.role || 'Agent'),
    purpose: String((agent as any).purpose || `执行 ${agent.role || 'Agent'} 专项任务。`),
    goal: String((agent as any).goal || ''),
    stepId: String(agent.stepId || '—'),
    status: String(agent.status || 'unknown'),
    resultSummary: String((agent as any).resultSummary || ''),
    changedFileCount: Number((agent as any).changedFileCount || 0),
    testCount: Number((agent as any).testCount || 0),
    startedAt: Number((agent as any).startedAt || 0),
    endedAt: Number((agent as any).endedAt || 0),
    updatedAt: Number((agent as any).updatedAt || task.updatedAt || 0),
  }))
}

export function taskTimeline(task: WorkbenchTask) {
  return [...(task.state?.coordinator?.timeline || [])].sort((left, right) => Number(right.at || 0) - Number(left.at || 0))
}

export function workbenchAgents(tasks: WorkbenchTask[] = []): WorkbenchAgent[] {
  return sortTasks(tasks).flatMap(task => taskAgents(task).map(agent => ({
    id: `${taskKeyForProjection(task)}\0${agent.id}`,
    name: String((agent as any).name || agent.agentType || 'Agent'),
    agentType: String(agent.agentType || 'general-purpose'),
    role: String(agent.role || 'Agent'),
    purpose: String((agent as any).purpose || '未记录目的'),
    goal: String((agent as any).goal || ''),
    status: String(agent.status || 'unknown'),
    projectKey: String(task.projectKey || '本地项目'),
    taskKey: taskKeyForProjection(task),
    taskName: taskDisplayName(task),
    stepId: String(agent.stepId || '—'),
    resultSummary: String((agent as any).resultSummary || ''),
    changedFileCount: Number((agent as any).changedFileCount || 0),
    testCount: Number((agent as any).testCount || 0),
    updatedAt: Number((agent as any).updatedAt || task.updatedAt || 0),
  }))).sort((left, right) => right.updatedAt - left.updatedAt)
}

export function workbenchSessions(tasks: WorkbenchTask[] = []): WorkbenchSession[] {
  const sessions = new Map<string, WorkbenchSession>()
  for (const task of sortTasks(tasks)) {
    const sessionId = String(task.sessionId || '').trim()
    if (!sessionId) continue
    const id = `${String(task.projectKey || '')}\0${sessionId}`
    const current = sessions.get(id)
    if (!current) {
      sessions.set(id, {id, sessionId, projectKey: String(task.projectKey || '本地项目'), status: taskStatus(task), taskCount: 1, latestTaskName: taskDisplayName(task), updatedAt: Number(task.updatedAt || 0)})
      continue
    }
    current.taskCount += 1
    if (Number(task.updatedAt || 0) > current.updatedAt) {
      current.status = taskStatus(task)
      current.latestTaskName = taskDisplayName(task)
      current.updatedAt = Number(task.updatedAt || 0)
    }
  }
  return [...sessions.values()].sort((left, right) => right.updatedAt - left.updatedAt)
}

function taskKeyForProjection(task: WorkbenchTask): string {
  return String(task.taskKey || task.taskId || task.sessionId || '')
}

export function taskWorkflows(task: WorkbenchTask): Array<{id: string; status: string}> {
  return Object.entries(task.state?.coordinator?.workflows || {}).map(([id, workflow]) => ({id, status: String(workflow.status || 'unknown')}))
}

export function taskSteps(task: WorkbenchTask): Array<{id: string; phase: string; role: string; status: string; required: boolean}> {
  return (task.state?.coordinator?.steps || []).map(step => ({
    id: String(step.stepId || 'step'),
    phase: String(step.phase || '—'),
    role: String(step.role || '—'),
    status: String(step.status || 'unknown'),
    required: step.required !== false,
  }))
}

export function taskIsBlocked(task: WorkbenchTask): boolean {
  const status = taskStatus(task)
  return BLOCKED_STATUSES.has(status) || (task.state?.coordinator?.blockerCodes?.length || 0) > 0
}

const TASK_EVENT_LABELS: Record<string, string> = {
  'task/created': '任务已创建',
  'task/accepted': '任务已接收',
  'task/input-appended': '收到补充问题',
  'task/state-changed': '任务状态变化',
  'task/coordinator-transition': 'Coordinator 状态变化',
  'task/coordinator-state-changed': 'Coordinator 状态变化',
  'task/blocked': '任务已阻塞',
  'task/waiting-user': '等待用户处理',
  'task/paused': '任务已暂停',
  'task/resumed': '任务已恢复',
  'task/complete-requested': '请求完成任务',
  'phase/started': '阶段开始',
  'phase/completed': '阶段完成',
  'phase/skipped': '阶段跳过',
  'phase/failed': '阶段失败',
  'agent/started': 'Agent 开始执行',
  'agent/completed': 'Agent 执行完成',
  'agent/failed': 'Agent 执行失败',
  'workflow/started': 'Workflow 开始执行',
  'workflow/completed': 'Workflow 执行完成',
  'workflow/failed': 'Workflow 执行失败',
  'verification/result': '验证结果已记录',
  'report/generated': '执行报告已生成',
  'rca/completed': '根因分析已完成',
  'task/metadata-backfilled': '任务元数据已回填',
}

const EVENT_STATUS_LABELS: Record<string, string> = {
  accepted: '已接收', planning: '规划中', running: '执行中', verifying: '验证中', reviewing: '审查中',
  changes_required: '待修改', fixing: '修复中', waiting_user: '等待用户', blocked: '已阻塞', paused: '已暂停',
  succeeded: '已成功', completed: '已完成', failed: '失败', inconclusive: '验证不足', regression_detected: '发现回归',
}

function eventText(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.replace(/[\0\r\n]+/g, ' ').trim().slice(0, max) : ''
}

export function taskEventLabel(eventType: unknown): string {
  const type = String(eventType || 'task/event')
  return TASK_EVENT_LABELS[type] || (type.startsWith('phase/') ? '执行阶段变化' : type.startsWith('agent/') ? 'Agent 执行变化' : type.startsWith('workflow/') ? 'Workflow 执行变化' : '任务事件')
}

export function taskEventSummary(event: Record<string, any> = {}): string {
  const type = String(event.eventType || 'task/event')
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {}
  const direct = [payload.summary, payload.reason, payload.outcome, payload.detail, payload.requestText].map(value => eventText(value)).find(Boolean)
  if (direct) return direct
  const status = eventText(payload.status, 80)
  const phase = eventText(payload.phase, 120)
  const stepId = eventText(payload.stepId, 120)
  const role = eventText(payload.role || payload.agentType, 120)
  const name = eventText(payload.name, 120)
  const verification = payload.verification && typeof payload.verification === 'object' ? payload.verification : null
  if (type === 'task/state-changed' || type.includes('coordinator')) {
    const state = EVENT_STATUS_LABELS[status] || status || '状态已更新'
    return [state, phase && `阶段：${phase}`, stepId && `步骤：${stepId}`].filter(Boolean).join(' · ')
  }
  if (type === 'task/created') return '已建立任务概述和初始问题记录'
  if (type === 'task/accepted') return '已进入任务队列，等待执行阶段开始'
  if (type === 'task/input-appended') return '补充问题已归入当前顶层任务'
  if (type.startsWith('phase/')) return [phase && `阶段：${phase}`, stepId && `步骤：${stepId}`, role && `角色：${role}`].filter(Boolean).join(' · ') || '阶段状态已更新'
  if (type.startsWith('agent/')) return [name || role || 'Agent', status && (EVENT_STATUS_LABELS[status] || status), stepId && `步骤：${stepId}`].filter(Boolean).join(' · ') || 'Agent 状态已更新'
  if (type.startsWith('workflow/')) return [name || eventText(payload.workflowId, 120) || 'Workflow', status && (EVENT_STATUS_LABELS[status] || status)].filter(Boolean).join(' · ') || 'Workflow 状态已更新'
  if (type === 'verification/result' && verification) return [EVENT_STATUS_LABELS[eventText(verification.status, 80)] || eventText(verification.status, 80), eventText(verification.evidenceLevel, 40) && `证据级别：${eventText(verification.evidenceLevel, 40)}`].filter(Boolean).join(' · ') || '验证结果已记录'
  return `已记录${taskEventLabel(type)}`
}

export function taskDisplayName(task: WorkbenchTask): string {
  const preferred = [task.title, task.summary]
    .map(value => String(value || '').trim())
    .find(value => value && value !== '未命名任务' && !isOpaqueTaskId(value))
  if (preferred) return preferred.slice(0, 80)
  const legacy = String(task.taskKey || task.taskId || '').replace(/:coordinator$/, '').trim()
  return /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(legacy) || /^[0-9a-f]{32,}$/i.test(legacy) ? '未命名任务' : legacy || '未命名任务'
}

function isOpaqueTaskId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(value) || /^[0-9a-f]{32,}$/i.test(value) || /^[0-9a-f]{16,}:[0-9a-f-]{8,}$/i.test(value)
}

export function sortTasks(tasks: WorkbenchTask[]): WorkbenchTask[] {
  return [...tasks].sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
}

export function dedupeTasks(tasks: WorkbenchTask[]): WorkbenchTask[] {
  const byIdentity = new Map<string, WorkbenchTask>()
  for (const task of tasks) {
    const taskId = String(task.taskId || task.taskKey || task.sessionId || '').replace(/:coordinator$/, '')
    const identity = `${String(task.projectKey || '')}\0${taskId}`
    const existing = byIdentity.get(identity)
    if (!existing) {
      byIdentity.set(identity, task)
      continue
    }
    const currentIsCoordinator = String(task.taskKey || '').endsWith(':coordinator')
    const existingIsCoordinator = String(existing.taskKey || '').endsWith(':coordinator')
    if (currentIsCoordinator && !existingIsCoordinator || currentIsCoordinator === existingIsCoordinator && Number(task.updatedAt || 0) > Number(existing.updatedAt || 0)) byIdentity.set(identity, task)
  }
  return [...byIdentity.values()]
}

export function activityItems(tasks: WorkbenchTask[], limit = 8): Array<{id: string; title: string; status: string; projectKey: string; updatedAt: number}> {
  return sortTasks(tasks).slice(0, Math.max(1, limit)).map((task, index) => ({
    id: String(task.taskKey || task.taskId || task.sessionId || `activity-${index}`),
    title: taskDisplayName(task),
    status: taskStatus(task),
    projectKey: String(task.projectKey || '本地项目'),
    updatedAt: Number(task.updatedAt || 0),
  }))
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

async function readJson(response: Response, fallback: any = {}) {
  const value = await response.json().catch(() => fallback)
  if (!response.ok) throw new Error(value?.error || `Gateway 请求失败 (${response.status})`)
  return value
}

export async function loadWorkbenchData({fetcher = fetch, baseUrl = 'http://127.0.0.1:3456', projectKey = '', activeOnly = false}: {fetcher?: FetchLike; baseUrl?: string; projectKey?: string; activeOnly?: boolean} = {}): Promise<WorkbenchData> {
  const query = new URLSearchParams()
  if (projectKey.trim()) query.set('projectKey', projectKey.trim())
  if (activeOnly) query.set('activeOnly', 'true')
  query.set('limit', '200')
  const suffix = `?${query.toString()}`
  const [tasksResponse, projectsResponse, reportsResponse, pitfallsResponse, healthResponse] = await Promise.all([
    fetcher(`${baseUrl}/api/workbench/tasks${suffix}`),
    fetcher(`${baseUrl}/api/workbench/projects`),
    fetcher(`${baseUrl}/api/workbench/reports${projectKey.trim() ? `?projectKey=${encodeURIComponent(projectKey.trim())}` : ''}`),
    fetcher(`${baseUrl}/api/workbench/pitfalls${projectKey.trim() ? `?projectKey=${encodeURIComponent(projectKey.trim())}` : ''}`),
    fetcher(`${baseUrl}/api/workbench/ai-health${projectKey.trim() ? `?projectKey=${encodeURIComponent(projectKey.trim())}` : ''}`),
  ])
  const tasks = await readJson(tasksResponse)
  const projects = projectsResponse.ok ? await readJson(projectsResponse) : {}
  const reports = await readJson(reportsResponse)
  const pitfalls = await readJson(pitfallsResponse)
  const health = await healthResponse.json().catch(() => ({}))
  return {
    projectKeys: Array.isArray(projects.projects)
      ? projects.projects.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : [...new Set((Array.isArray(tasks.tasks) ? tasks.tasks : []).map((item: any) => String(item?.projectKey || '').trim()).filter(Boolean))].sort(),
    tasks: Array.isArray(tasks.tasks) ? dedupeTasks(tasks.tasks) : [],
    reports: Array.isArray(reports.reports) ? reports.reports : [],
    pitfalls: Array.isArray(pitfalls.pitfalls) ? pitfalls.pitfalls : [],
    health: health.health || null,
    driftCandidates: Array.isArray(health.driftCandidates) ? health.driftCandidates : [],
    stateStoreDegraded: tasks.stateStoreDegraded === true,
  }
}

export async function loadWorkbenchTaskDetail({fetcher = fetch, baseUrl = 'http://127.0.0.1:3456', projectKey, taskId}: {fetcher?: FetchLike; baseUrl?: string; projectKey: string; taskId: string}): Promise<WorkbenchTaskDetail> {
  const encoded = encodeURIComponent(taskId)
  const query = `?projectKey=${encodeURIComponent(projectKey)}`
  const response = await fetcher(`${baseUrl}/api/workbench/tasks/${encoded}${query}`)
  return readJson(response)
}
