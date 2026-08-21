export type TaskActivityPhase =
  | 'idle'
  | 'starting'
  | 'planning'
  | 'thinking'
  | 'tool'
  | 'agent'
  | 'waiting'
  | 'compacting'
  | 'responding'
  | 'reviewing'
  | 'verifying'
  | 'blocked'
  | 'fixing'
  | 'completed'
  | 'failed'
  | 'stopped'

export type TaskActivityEntryStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'stopped'

export type TaskActivityEntryKind =
  | 'task'
  | 'planning'
  | 'thinking'
  | 'tool'
  | 'agent'
  | 'workflow'
  | 'waiting'
  | 'compacting'
  | 'response'
  | 'review'
  | 'verification'
  | 'coordinator'

export interface TaskActivityEntry {
  id: string
  kind: TaskActivityEntryKind
  status: TaskActivityEntryStatus
  title: string
  detail: string
  startedAt: number
  updatedAt: number
  completedAt: number
  durationMs: number
  eventType: string
  expanded?: boolean
}

export interface TaskActivityState {
  phase: TaskActivityPhase
  running: boolean
  title: string
  detail: string
  startedAt: number
  updatedAt: number
  eventType: string
  entries: TaskActivityEntry[]
  expanded: boolean
}

export interface TaskActivityFreshness {
  level: 'active' | 'waiting' | 'stale' | 'idle'
  idleMs: number
  message: string
}

const MAX_ENTRIES = 80

function boundedText(value: unknown, max = 200): string {
  if (typeof value !== 'string') return ''
  const normalized = value.replace(/\s+/g, ' ').trim()
  const redacted = normalized
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [已脱敏]')
    .replace(/\b(?:sk|key|token)-[A-Za-z0-9._-]{8,}\b/gi, '[已脱敏]')
    .replace(/((?:api[_-]?key|access[_-]?token|auth(?:orization)?)\s*[:=]\s*)[^\s,;]+/gi, '$1[已脱敏]')
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[已脱敏]@')
  return redacted.length > max ? `${redacted.slice(0, Math.max(0, max - 1))}…` : redacted
}

function trailingText(value: unknown, max = 200): string {
  const normalized = boundedText(value, Math.max(max * 3, max))
  return normalized.length > max ? `…${normalized.slice(-(max - 1))}` : normalized
}

function toolDetail(event: any): string {
  const input = event?.input && typeof event.input === 'object' ? event.input : {}
  const direct = input.file_path || input.path || input.query || input.pattern || input.command
    || input.url || input.description || event?.description
    || (typeof input.partial_json === 'string' ? input.partial_json : '')
    || (typeof event?.partial_json === 'string' ? event.partial_json : '')
  return boundedText(direct)
}

function toolName(event: any): string {
  return boundedText(event?.tool_name || event?.toolName, 80) || '工具'
}

function toolTitle(name: string): string {
  const titles: Record<string, string> = {
    Read: '读取文件',
    Write: '写入文件',
    Edit: '编辑文件',
    Bash: '运行命令',
    Grep: '搜索代码',
    Glob: '查找文件',
    Skill: '加载技能',
    EnterPlanMode: '进入规划模式',
    ExitPlanMode: '完成规划',
    WebFetch: '读取网页',
    WebSearch: '搜索资料',
    Task: '启动 Agent',
    TaskCreate: '创建任务',
  }
  return titles[name] || `使用 ${name}`
}

function agentName(event: any): string {
  return boundedText(event?.agentType || event?.agentName || event?.label || event?.agentId || event?.id, 80) || 'Agent'
}

function eventId(event: any, fallback: string): string {
  const raw = event?.tool_use_id || event?.toolUseId || event?.requestId || event?.agentId
    || event?.id || event?.workflowId || event?.index
  return boundedText(raw == null ? '' : String(raw), 120) || fallback
}

function normalizeEntry(input: Partial<TaskActivityEntry>): TaskActivityEntry {
  const startedAt = Number.isFinite(Number(input.startedAt)) ? Number(input.startedAt) : 0
  const updatedAt = Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : startedAt
  const completedAt = Number.isFinite(Number(input.completedAt)) ? Number(input.completedAt) : 0
  return {
    id: boundedText(input.id, 180),
    kind: input.kind || 'task',
    status: input.status || 'running',
    title: boundedText(input.title),
    detail: boundedText(input.detail),
    startedAt,
    updatedAt,
    completedAt,
    durationMs: Number.isFinite(Number(input.durationMs)) ? Math.max(0, Number(input.durationMs)) : 0,
    eventType: boundedText(input.eventType, 80),
    expanded: input.expanded === true,
  }
}

export function createTaskActivityState(input: Partial<TaskActivityState> = {}): TaskActivityState {
  return {
    phase: input.phase || 'idle',
    running: input.running === true,
    title: boundedText(input.title),
    detail: boundedText(input.detail),
    startedAt: Number.isFinite(Number(input.startedAt)) ? Number(input.startedAt) : 0,
    updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : 0,
    eventType: boundedText(input.eventType, 80),
    entries: Array.isArray(input.entries) ? input.entries.map(normalizeEntry).slice(-MAX_ENTRIES) : [],
    expanded: input.expanded !== false,
  }
}

function completeEntries(
  entries: TaskActivityEntry[],
  now: number,
  predicate: (entry: TaskActivityEntry) => boolean,
  status: TaskActivityEntryStatus = 'completed',
): TaskActivityEntry[] {
  return entries.map(entry => {
    if (!['running', 'waiting'].includes(entry.status) || !predicate(entry)) return entry
    return {
      ...entry,
      status,
      updatedAt: now,
      completedAt: now,
      durationMs: Math.max(entry.durationMs, now - entry.startedAt),
    }
  })
}

function upsertEntry(
  state: TaskActivityState,
  input: Partial<TaskActivityEntry> & Pick<TaskActivityEntry, 'id' | 'kind' | 'status' | 'title'>,
  now: number,
): TaskActivityState {
  const entries = [...state.entries]
  const index = entries.findIndex(entry => entry.id === input.id)
  if (index >= 0) {
    const current = entries[index]
    const completedAt = input.completedAt ?? (['completed', 'failed', 'stopped'].includes(input.status) ? now : current.completedAt)
    entries[index] = normalizeEntry({
      ...current,
      ...input,
      detail: input.detail === undefined ? current.detail : input.detail,
      startedAt: current.startedAt || input.startedAt || now,
      updatedAt: now,
      completedAt,
      durationMs: input.durationMs ?? (completedAt ? Math.max(0, completedAt - (current.startedAt || now)) : current.durationMs),
    })
  } else {
    entries.push(normalizeEntry({
      ...input,
      startedAt: input.startedAt || now,
      updatedAt: now,
      completedAt: input.completedAt || 0,
      durationMs: input.durationMs || 0,
    }))
  }
  return {...state, entries: entries.slice(-MAX_ENTRIES)}
}

function activityState(
  state: TaskActivityState,
  phase: TaskActivityPhase,
  running: boolean,
  title: string,
  detail: string,
  type: string,
  now: number,
): TaskActivityState {
  return {
    ...state,
    phase,
    running,
    title: boundedText(title),
    detail: boundedText(detail),
    startedAt: state.startedAt || now,
    updatedAt: now,
    eventType: type,
  }
}

function elapsedMs(event: any): number {
  const seconds = Number(event?.elapsed_time_seconds ?? event?.elapsed?.elapsed_time_seconds ?? event?.elapsed)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : 0
}

export function reduceTaskActivity(
  current: TaskActivityState,
  event: any,
  now = Date.now(),
): TaskActivityState {
  let state = createTaskActivityState(current)
  const type = String(event?.type || '')
  const startsNewActivity = ['task_started', 'workflow_started', 'workflow_resumed'].includes(type)

  // 终态事件可能因 WebSocket 排队或后台标签页恢复而迟到；只允许明确的新任务或恢复重新激活。
  if (!state.running && ['completed', 'failed', 'stopped'].includes(state.phase) && !startsNewActivity) return state

  if (type === 'task_started') {
    const eventStartedAt = Number(event.startedAt ?? event.taskState?.startedAt)
    const startedAt = Number.isFinite(eventStartedAt) && eventStartedAt > 0 ? eventStartedAt : now
    const coordinatorEntries = state.running ? state.entries.filter(entry => entry.eventType === 'task_coordinator_event') : []
    state = createTaskActivityState({phase: 'starting', running: true, startedAt: coordinatorEntries.length ? state.startedAt || startedAt : startedAt, updatedAt: now, expanded: true, entries: coordinatorEntries})
    state = activityState(state, 'starting', true, '任务已接收，正在启动', '', type, now)
    return upsertEntry(state, {
      id: 'task:start', kind: 'task', status: 'completed', title: '任务已接收', startedAt,
      completedAt: now, durationMs: Math.max(0, now - startedAt), eventType: type,
    }, now)
  }

  if (type === 'task_coordinator_event') {
    const phase = String(event.phase || '')
    const labels: Record<string, string> = {
      prime: '建立项目上下文', plan: '制定执行计划', implement: '实现代码变更',
      validate: '验证本次修改', review: '定向审查变更', report: '整理最终报告',
    }
    const terminal = [
      'completed', 'failed', 'blocked', 'inconclusive', 'regression_detected', 'paused',
      'diagnosis_required', 'awaiting_reproduction', 'blocked_external', 'architecture_change_required',
    ].includes(String(event.status || ''))
    const failed = terminal && event.status !== 'completed'
    const started = event.event === 'phase/started'
    const completed = event.event === 'phase/completed'
    const status: TaskActivityEntryStatus = failed ? 'failed' : completed || terminal ? 'completed' : 'running'
    const evidence = boundedText(event.verification?.evidenceLevel, 20)
    const detail = [boundedText(event.role, 80), evidence ? `证据 ${evidence}` : '', boundedText(event.detail)].filter(Boolean).join(' · ')
    const title = labels[phase] || boundedText(event.detail) || '任务协调器'
    state = activityState(state, phase === 'validate' ? 'verifying' : phase === 'review' ? 'reviewing' : failed ? 'blocked' : 'planning', !terminal, title, detail, type, now)
    return upsertEntry(state, {
      id: `coordinator:${event.stepId || phase || event.status || event.revision}`,
      kind: phase === 'validate' ? 'verification' : 'coordinator', status,
      title: `${started ? '开始' : completed ? '完成' : ''}${title}`,
      detail, completedAt: status !== 'running' ? now : 0, eventType: type,
    }, now)
  }

  if (type === 'task_input_added') {
    state = activityState(state, state.phase === 'idle' ? 'starting' : state.phase, true, '已注入补充指令，继续执行', boundedText(event.source), type, now)
    return upsertEntry(state, {
      id: `input:${now}`, kind: 'task', status: 'completed', title: '已接收补充指令',
      detail: boundedText(event.source), completedAt: now, eventType: type,
    }, now)
  }

  if (type === 'task_auto_continuing') {
    const attempt = Math.max(1, Math.trunc(Number(event.attempt) || 1))
    const maxAttempts = Math.max(attempt, Math.trunc(Number(event.maxAttempts) || attempt))
    const completedTurns = Math.max(0, Math.trunc(Number(event.completedTurns) || 0))
    const parts = [`第 ${attempt}/${maxAttempts} 次`]
    if (completedTurns) parts.push(`累计 ${completedTurns} 轮`)
    const detail = parts.join(' · ')
    state = activityState(state, 'starting', true, '已达到单段轮数上限，正在自动续跑', detail, type, now)
    return upsertEntry(state, {
      id: `task:auto-continue:${attempt}`, kind: 'task', status: 'running',
      title: '自动续跑当前任务', detail, eventType: type,
    }, now)
  }

  if (type === 'task_decision') {
    const tier = boundedText(event.modelTier || event.model, 80)
    state = activityState(state, 'planning', true, '正在规划执行方式', tier ? `使用 ${tier} 档位` : '', type, now)
    return upsertEntry(state, {
      id: 'task:planning', kind: 'planning', status: 'completed', title: '执行方案已确定',
      detail: tier ? `模型档位：${tier}` : boundedText(event.action), completedAt: now, eventType: type,
    }, now)
  }

  if (type === 'thinking_start' || type === 'thinking_delta') {
    const id = `thinking:${eventId(event, 'current')}`
    const existing = state.entries.find(entry => entry.id === id)
    const detail = type === 'thinking_delta'
      ? trailingText(`${existing?.detail || ''}${event.thinking || ''}`)
      : boundedText(event.thinking)
    state = activityState(state, 'thinking', true, '正在分析任务', detail, type, now)
    return upsertEntry(state, {
      id, kind: 'thinking', status: 'running', title: '分析与推理', detail, eventType: type,
    }, now)
  }

  if (type === 'tool_use_start') {
    const name = toolName(event)
    state.entries = completeEntries(state.entries, now, entry => entry.kind === 'thinking')
    state = activityState(state, 'tool', true, `正在${toolTitle(name)}`, toolDetail(event), type, now)
    return upsertEntry(state, {
      id: `tool:${eventId(event, `${name}:${now}`)}`, kind: 'tool', status: 'running',
      title: toolTitle(name), detail: toolDetail(event), eventType: type,
    }, now)
  }

  if (type === 'tool_progress') {
    const name = toolName(event)
    const durationMs = elapsedMs(event)
    const entryId = `tool:${eventId(event, name)}`
    const previousDetail = state.entries.find(entry => entry.id === entryId)?.detail || ''
    const detail = boundedText(event.detail || event.message) || previousDetail || (durationMs ? `已执行 ${Math.round(durationMs / 1000)} 秒` : '')
    state = activityState(state, 'tool', true, `正在${toolTitle(name)}`, detail, type, now)
    return upsertEntry(state, {
      id: entryId, kind: 'tool', status: 'running', title: toolTitle(name),
      detail, durationMs, eventType: type,
    }, now)
  }

  if (type === 'tool_input_update') {
    const name = toolName(event)
    const detail = toolDetail(event) || '正在准备工具参数'
    state = activityState(state, 'tool', true, `正在${toolTitle(name)}`, detail, type, now)
    return upsertEntry(state, {
      id: `tool:${eventId(event, name)}`, kind: 'tool', status: 'running', title: toolTitle(name),
      detail, eventType: type,
    }, now)
  }

  if (type === 'content_block_stop') {
    const rawId = eventId(event, '')
    const thinking = rawId.startsWith('thought_') || String(event?.index || '').startsWith('thought_')
    const prefix = thinking ? 'thinking:' : 'tool:'
    const id = `${prefix}${rawId || (thinking ? 'current' : '')}`
    const durationMs = elapsedMs(event)
    state.entries = completeEntries(state.entries, now, entry => entry.id === id || (!rawId && entry.kind === (thinking ? 'thinking' : 'tool')))
    if (durationMs) {
      const index = state.entries.findIndex(entry => entry.id === id)
      if (index >= 0) state.entries[index] = {...state.entries[index], durationMs}
    }
    return {...state, updatedAt: now, eventType: type}
  }

  if (['subagent_spawning', 'subagent_start', 'agent_start', 'workflow_agent_start', 'workflow_agent_started'].includes(type)) {
    const name = agentName(event)
    const detail = boundedText(event.task || event.description || event.progress)
    state = activityState(state, 'agent', true, `Agent ${name} 正在执行`, detail, type, now)
    return upsertEntry(state, {
      id: `agent:${eventId(event, name)}`, kind: 'agent', status: 'running', title: `Agent ${name}`,
      detail, eventType: type,
    }, now)
  }

  if (['subagent_progress', 'agent_progress'].includes(type)) {
    const name = agentName(event)
    const detail = boundedText(event.progress || event.currentAction || event.description)
    state = activityState(state, 'agent', true, `Agent ${name} 正在执行`, detail, type, now)
    return upsertEntry(state, {
      id: `agent:${eventId(event, name)}`, kind: 'agent', status: 'running', title: `Agent ${name}`,
      detail, eventType: type,
    }, now)
  }

  if (['subagent_done', 'workflow_agent_done', 'agent_done'].includes(type)) {
    const name = agentName(event)
    state = activityState(state, 'thinking', true, `Agent ${name} 已完成，继续主任务`, boundedText(event.summary), type, now)
    return upsertEntry(state, {
      id: `agent:${eventId(event, name)}`, kind: 'agent', status: 'completed', title: `Agent ${name}`,
      detail: boundedText(event.summary), completedAt: now, eventType: type,
    }, now)
  }

  if (['workflow_agent_error', 'agent_error', 'subagent_error'].includes(type)) {
    const name = agentName(event)
    state = activityState(state, 'agent', true, `Agent ${name} 执行失败`, boundedText(event.error || event.message), type, now)
    return upsertEntry(state, {
      id: `agent:${eventId(event, name)}`, kind: 'agent', status: 'failed', title: `Agent ${name}`,
      detail: boundedText(event.error || event.message), completedAt: now, eventType: type,
    }, now)
  }

  if (type === 'permission_request' || type === 'choice_request') {
    const question = Array.isArray(event.questions) ? event.questions[0]?.question : event.question
    const permission = type === 'permission_request'
    const detail = permission ? boundedText(event.summary || event.toolName || toolDetail(event)) : boundedText(question)
    const title = permission ? '等待工具权限确认' : '等待方案选择'
    state = activityState(state, 'waiting', true, title, detail, type, now)
    return upsertEntry(state, {
      id: `waiting:${eventId(event, type)}`, kind: 'waiting', status: 'waiting', title, detail, eventType: type,
    }, now)
  }

  if (type === 'confirmation_resolved') {
    const waitingId = `waiting:${eventId(event, 'confirmation')}`
    state.entries = completeEntries(state.entries, now, entry => entry.id === waitingId)
    const remaining = [...state.entries].reverse().find(entry => entry.kind === 'waiting' && entry.status === 'waiting')
    if (remaining) {
      return activityState(state, 'waiting', true, remaining.title, remaining.detail, type, now)
    }

    if (event.confirmationType === 'permission') {
      const action = toolTitle(toolName(event))
      const allowed = event.decision !== 'deny'
      const detail = event.wonBy === 'auto' ? '已切换为全部自动' : allowed ? '已允许本次操作' : '已拒绝本次操作'
      return activityState(
        state,
        allowed ? 'tool' : 'thinking',
        true,
        allowed
          ? `${event.wonBy === 'auto' ? '权限已自动允许' : '权限已允许'}，正在${action}`
          : `已拒绝${action}，正在继续处理`,
        detail,
        type,
        now,
      )
    }

    return activityState(state, 'thinking', true, '方案已确认，正在继续执行', '', type, now)
  }

  if (type === 'context_compacting' || type === 'context_compacted') {
    const completed = type === 'context_compacted'
    const title = completed ? '上下文压缩完成' : '正在压缩上下文'
    const detail = type === 'context_compacting' ? (event.trigger === 'manual' ? '手动压缩' : '自动压缩') : ''
    state = activityState(state, completed ? 'thinking' : 'compacting', true, completed ? `${title}，继续执行` : title, detail, type, now)
    return upsertEntry(state, {
      id: 'context:compaction', kind: 'compacting', status: completed ? 'completed' : 'running',
      title, detail, completedAt: completed ? now : 0, eventType: type,
    }, now)
  }

  if (type === 'assistant_message' || type === 'text_delta') {
    state.entries = completeEntries(state.entries, now, entry => entry.kind === 'thinking')
    state = activityState(state, 'responding', true, '正在整理并生成回复', '', type, now)
    return upsertEntry(state, {
      id: 'task:response', kind: 'response', status: 'running', title: '整理任务结果', eventType: type,
    }, now)
  }

  if (type === 'primary_completed' || type === 'task_reviewing' || type === 'task_changes_required') {
    const changes = type === 'task_changes_required'
    const title = changes ? '审查发现需要修复的问题' : '正在进行定向审查'
    state = activityState(state, 'reviewing', true, title, boundedText(event.detail), type, now)
    return upsertEntry(state, {
      id: 'task:review', kind: 'review', status: 'running', title, detail: boundedText(event.detail), eventType: type,
    }, now)
  }

  if (type === 'task_fixing') {
    state = activityState(state, 'fixing', true, '正在修复审查问题', boundedText(event.detail), type, now)
    return upsertEntry(state, {
      id: 'task:fixing', kind: 'review', status: 'running', title: '修复审查问题',
      detail: boundedText(event.detail), eventType: type,
    }, now)
  }

  if (type === 'workflow_started' || type === 'workflow_resumed') {
    const name = boundedText(event.name) || '工作流'
    if (type === 'workflow_started' && !state.running) state.startedAt = now
    state = activityState(state, 'planning', true, `${name} 正在启动`, '', type, now)
    return upsertEntry(state, {
      id: `workflow:${eventId(event, name)}`, kind: 'workflow', status: 'running', title: name,
      detail: type === 'workflow_resumed' ? '已恢复' : '正在启动', eventType: type,
    }, now)
  }

  if (type === 'workflow_phase' || type === 'workflow_log') {
    const workflowId = eventId(event, 'current')
    const phase = boundedText(event.phase || event.currentPhase, 100)
    const detail = boundedText(event.message || event.detail || phase)
    state = activityState(state, 'agent', true, phase ? `正在执行：${phase}` : '工作流正在执行', detail, type, now)
    return upsertEntry(state, {
      id: `workflow:${workflowId}:${phase || 'current'}`, kind: 'workflow', status: 'running',
      title: phase || '工作流阶段', detail, eventType: type,
    }, now)
  }

  if (['workflow_done', 'workflow_paused', 'workflow_error'].includes(type)) {
    const status: TaskActivityEntryStatus = type === 'workflow_done' ? 'completed' : type === 'workflow_paused' ? 'waiting' : 'failed'
    const workflowId = eventId(event, 'current')
    state.entries = completeEntries(state.entries, now, entry => entry.kind === 'workflow' && entry.id.includes(workflowId), status)
    return {...state, updatedAt: now, eventType: type}
  }

  const terminal = type === 'task_completed'
    ? {phase: 'completed' as const, status: 'completed' as const, title: '任务已完成'}
    : type === 'generation_stopped'
      ? {phase: 'stopped' as const, status: 'stopped' as const, title: '任务已停止'}
      : ['task_failed', 'task_review_paused', 'task_verification_inconclusive', 'stream_error', 'error'].includes(type)
        ? {phase: 'failed' as const, status: 'failed' as const, title: type === 'task_review_paused' ? '最终审查已暂停' : type === 'task_verification_inconclusive' ? '任务验证不足' : '任务执行失败'}
        : null

  if (terminal) {
    const detail = boundedText(event.detail || event.message || event.error)
    state.entries = completeEntries(state.entries, now, () => true, terminal.status)
    state = activityState(state, terminal.phase, false, terminal.title, detail, type, now)
    return upsertEntry(state, {
      id: 'task:terminal', kind: 'task', status: terminal.status, title: terminal.title,
      detail, completedAt: now, durationMs: state.startedAt ? now - state.startedAt : 0, eventType: type,
    }, now)
  }

  return state
}

export function taskActivityFreshness(
  state: TaskActivityState,
  now = Date.now(),
  waitingAfterMs = 60_000,
  staleAfterMs = 180_000,
): TaskActivityFreshness {
  if (!state.running || !state.updatedAt) return {level: 'idle', idleMs: 0, message: ''}
  const idleMs = Math.max(0, now - state.updatedAt)
  if (idleMs >= staleAfterMs) {
    return {level: 'stale', idleMs, message: '较长时间未收到新事件，请检查 API、权限窗口或工具进程'}
  }
  if (idleMs >= waitingAfterMs) {
    return {level: 'waiting', idleMs, message: '暂未收到新事件，可能正在等待 API 或工具返回'}
  }
  return {level: 'active', idleMs, message: '持续收到执行事件'}
}
