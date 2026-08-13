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
  | 'fixing'
  | 'completed'
  | 'failed'
  | 'stopped'

export interface TaskActivityState {
  phase: TaskActivityPhase
  running: boolean
  title: string
  detail: string
  startedAt: number
  updatedAt: number
  eventType: string
}

export interface TaskActivityFreshness {
  level: 'active' | 'waiting' | 'stale' | 'idle'
  idleMs: number
  message: string
}

function boundedText(value: unknown, max = 160): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function trailingText(value: unknown, max = 160): string {
  if (typeof value !== 'string') return ''
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? normalized.slice(-max) : normalized
}

function toolDetail(event: any): string {
  const input = event?.input && typeof event.input === 'object' ? event.input : {}
  return boundedText(
    input.file_path || input.path || input.command || input.query || input.pattern || event?.description,
  )
}

function agentName(event: any): string {
  return boundedText(event?.agentType || event?.agentName || event?.label || event?.agentId || event?.id) || 'Agent'
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
  }
}

export function reduceTaskActivity(
  current: TaskActivityState,
  event: any,
  now = Date.now(),
): TaskActivityState {
  const state = createTaskActivityState(current)
  const type = String(event?.type || '')
  const start = state.startedAt || now
  const active = (phase: TaskActivityPhase, title: string, detail = ''): TaskActivityState => ({
    phase,
    running: true,
    title,
    detail: boundedText(detail),
    startedAt: start,
    updatedAt: now,
    eventType: type,
  })
  const terminal = (phase: TaskActivityPhase, title: string, detail = ''): TaskActivityState => ({
    phase,
    running: false,
    title,
    detail: boundedText(detail),
    startedAt: state.startedAt,
    updatedAt: now,
    eventType: type,
  })

  if (type === 'task_started') {
    const eventStartedAt = Number(event.startedAt ?? event.taskState?.startedAt)
    return {
      ...active('starting', '任务已接收，正在启动'),
      startedAt: Number.isFinite(eventStartedAt) && eventStartedAt > 0 ? eventStartedAt : now,
    }
  }
  if (type === 'task_input_added') {
    return active(state.phase === 'idle' ? 'starting' : state.phase, '已注入补充指令，继续执行', boundedText(event.source))
  }
  if (type === 'task_decision') {
    const tier = boundedText(event.modelTier || event.model)
    return active('planning', '正在规划执行方式', tier ? `使用 ${tier} 档位` : '')
  }
  if (type === 'thinking_start') {
    return active('thinking', '正在分析任务', boundedText(event.thinking, 160))
  }
  if (type === 'thinking_delta') {
    const previous = state.phase === 'thinking' ? state.detail : ''
    return active('thinking', '正在分析任务', trailingText(`${previous}${event.thinking || ''}`, 160))
  }
  if (type === 'tool_use_start') {
    const tool = boundedText(event.tool_name || event.toolName) || '工具'
    return active('tool', `正在使用 ${tool}`, toolDetail(event))
  }
  if (type === 'tool_progress') {
    const tool = boundedText(event.tool_name || event.toolName) || boundedText(state.title.replace(/^正在使用\s*/, '')) || '工具'
    const rawElapsed = event.elapsed_time_seconds ?? event.elapsed
    const elapsed = Number.isFinite(Number(rawElapsed)) ? `已执行 ${Math.max(0, Math.round(Number(rawElapsed)))} 秒` : ''
    return active('tool', `正在执行 ${tool}`, boundedText(event.detail || event.message) || elapsed)
  }
  if (['subagent_start', 'agent_start', 'workflow_agent_start', 'workflow_agent_started'].includes(type)) {
    const name = agentName(event)
    return active('agent', `Agent ${name} 正在执行`, boundedText(event.task || event.description || event.progress))
  }
  if (['subagent_progress', 'agent_progress'].includes(type)) {
    const name = agentName(event)
    return active('agent', `Agent ${name} 正在执行`, boundedText(event.progress || event.currentAction || event.description))
  }
  if (type === 'permission_request' || type === 'choice_request') {
    const question = Array.isArray(event.questions) ? event.questions[0]?.question : event.question
    const detail = type === 'permission_request'
      ? boundedText(event.summary || event.toolName || toolDetail(event))
      : boundedText(question)
    return active('waiting', type === 'permission_request' ? '等待工具权限确认' : '等待方案选择', detail)
  }
  if (type === 'context_compacting') {
    return active('compacting', '正在压缩上下文', event.trigger === 'manual' ? '手动压缩' : '自动压缩')
  }
  if (type === 'context_compacted') {
    return active('thinking', '上下文压缩完成，继续执行')
  }
  if (type === 'context_compaction_summary') {
    return active('compacting', '正在整理压缩摘要')
  }
  if (type === 'assistant_message' || type === 'text_delta') {
    return active('responding', '正在整理并生成回复')
  }
  if (type === 'primary_completed' || type === 'task_reviewing') {
    return active('reviewing', '主任务已完成，正在审查', boundedText(event.detail))
  }
  if (type === 'task_changes_required') {
    return active('reviewing', '审查发现需要修复的问题', boundedText(event.detail))
  }
  if (type === 'task_fixing') {
    return active('fixing', '正在修复审查问题', boundedText(event.detail))
  }
  if (type === 'workflow_started' || type === 'workflow_resumed') {
    return active('planning', `工作流 ${boundedText(event.name) || ''} 正在启动`.replace(/\s+/g, ' ').trim())
  }
  if (type === 'workflow_phase') {
    return active('agent', '正在执行工作流阶段', boundedText(event.phase))
  }
  if (type === 'workflow_log') {
    return active('agent', '工作流正在执行', boundedText(event.message))
  }
  if (type === 'subagent_done') {
    return active('thinking', `Agent ${agentName(event)} 已完成，继续主任务`, boundedText(event.summary))
  }
  if (type === 'task_review_paused') return terminal('failed', '最终审查已暂停', boundedText(event.detail))
  if (type === 'task_completed') return terminal('completed', '任务已完成', boundedText(event.detail))
  if (type === 'task_failed' || type === 'stream_error') return terminal('failed', '任务执行失败', boundedText(event.detail || event.message || event.error))
  if (type === 'generation_stopped') return terminal('stopped', '任务已停止')
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
