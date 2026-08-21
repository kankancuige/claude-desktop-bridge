export type ParentTaskPhase = 'idle' | 'running' | 'reviewing' | 'changes_required' | 'fixing' | 'review_paused' | 'succeeded' | 'incomplete' | 'failed'

export interface ParentTaskUiState {
  phase: ParentTaskPhase
  primaryResultSeen: boolean
  completionShown: boolean
  detail: string
  taskId: string
  sequence: number
}

/**
 * SDK 的 content block 可能只带换行或空白字符。此类内容不是用户可见回复，
 * 必须在创建 assistant 消息前剔除，避免渲染出只有 AI 标签的空壳气泡。
 */
export function normalizeAssistantText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * SDK assistant_message 可能先于 Coordinator 终态到达；若两者正文相同，
 * 只保留带成功 taskResult 的末尾气泡，避免最终总结在中间重复出现。
 */
export function removeSupersededAssistantMessages<T extends {role?: unknown; text?: unknown; taskResult?: {outcome?: unknown}}>(messages: T[]): T[] {
  const hidden = new Set<number>()
  messages.forEach((message, finalIndex) => {
    if (message.role !== 'assistant' || message.taskResult?.outcome !== 'succeeded') return
    let userIndex = -1
    for (let index = finalIndex - 1; index >= 0; index--) {
      if (messages[index].role === 'user') {
        userIndex = index
        break
      }
    }
    if (userIndex < 0) return
    const finalText = normalizeAssistantText(message.text)
    if (!finalText) return
    for (let index = userIndex + 1; index < finalIndex; index++) {
      const candidate = messages[index]
      if (candidate.role === 'assistant' && candidate.taskResult?.outcome !== 'succeeded'
          && normalizeAssistantText(candidate.text) === finalText) hidden.add(index)
    }
  })
  return messages.filter((_message, index) => !hidden.has(index))
}

/**
 * 父任务完成的权威正文来自 Coordinator 终态事件；SDK result 仅表示主回合结束。
 * 优先使用即时 reply，重连或恢复场景才回退到持久化的 finalReplyText。
 */
export function selectSucceededTaskSummary(input: {reply?: unknown; finalReplyText?: unknown}): string {
  return normalizeAssistantText(input.reply) || normalizeAssistantText(input.finalReplyText)
}

/**
 * SDK result 的成功只表示主回合结束。若 Completion Gate 后续给出非成功终态，
 * 不能再把这条待展示的成功统计追加到聊天末尾，否则会覆盖真实终态语义。
 */
export function shouldShowPendingResultForTerminal(input: {terminalType?: unknown; pendingOutcome?: unknown}): boolean {
  const terminalType = String(input.terminalType || '')
  const pendingOutcome = String(input.pendingOutcome || '')
  if (!['task_review_paused', 'task_verification_inconclusive', 'task_failed'].includes(terminalType)) return true
  return pendingOutcome !== 'succeeded'
}

export function createParentTaskUiState(input: Partial<ParentTaskUiState> = {}): ParentTaskUiState {
  return {
    phase: input.phase || 'idle',
    primaryResultSeen: input.primaryResultSeen === true,
    completionShown: input.completionShown === true,
    detail: String(input.detail || '').slice(0, 2000),
    taskId: String(input.taskId || ''),
    sequence: Number.isFinite(Number(input.sequence)) ? Math.max(0, Math.trunc(Number(input.sequence))) : 0,
  }
}

/**
 * 重连快照只是状态投影，不能在终态事件到达前把最终总结标记为已展示。
 * 同一任务已经展示过总结时保留该标记，避免迟到快照触发重复气泡。
 */
export function mergeParentTaskSnapshot(current: ParentTaskUiState, snapshot: any): ParentTaskUiState {
  const previous = createParentTaskUiState(current)
  const status = String(snapshot?.status || 'idle')
  const taskId = String(snapshot?.taskId || '')
  const sameTask = !taskId || !previous.taskId || taskId === previous.taskId
  return createParentTaskUiState({
    phase: (['running', 'reviewing', 'changes_required', 'fixing', 'review_paused', 'succeeded', 'incomplete', 'failed'].includes(status)
      ? status
      : 'idle') as ParentTaskPhase,
    completionShown: sameTask && previous.completionShown,
    detail: String(snapshot?.detail || ''),
    taskId,
    sequence: Number(snapshot?.sequence || 0),
  })
}

export function reduceParentTaskUi(current: ParentTaskUiState, event: any): {state: ParentTaskUiState, showCompletion: boolean} {
  const state = createParentTaskUiState(current)
  const eventTaskId = String(event?.taskId || '')
  const eventSequence = Number.isFinite(Number(event?.sequence)) ? Math.max(0, Math.trunc(Number(event.sequence))) : 0
  if (eventTaskId && state.taskId && eventTaskId === state.taskId && eventSequence > 0 && eventSequence <= state.sequence) {
    return {state, showCompletion: false}
  }
  const eventState = eventTaskId
    ? {...state, taskId: eventTaskId, sequence: eventSequence, ...(eventTaskId !== state.taskId ? {completionShown: false} : {})}
    : state
  if (event?.type === 'task_started') {
    return {state: {...eventState, phase: 'running', primaryResultSeen: false, detail: ''}, showCompletion: false}
  }
  if (event?.type === 'primary_completed') {
    return {state: {...eventState, primaryResultSeen: true}, showCompletion: false}
  }
  if (event?.type === 'result') {
    return {state: {...eventState, primaryResultSeen: true}, showCompletion: false}
  }
  const phaseMap: Record<string, ParentTaskPhase> = {
    task_reviewing: 'reviewing',
    task_changes_required: 'changes_required',
    task_fixing: 'fixing',
    task_review_paused: 'review_paused',
    task_verification_inconclusive: 'incomplete',
    task_failed: 'failed',
    task_completed: 'succeeded',
  }
  const phase = phaseMap[event?.type]
  if (!phase) return {state: eventState, showCompletion: false}
  if (event.type === 'task_completed') {
    if (eventState.completionShown) return {state: eventState, showCompletion: false}
    return {
      state: {...eventState, phase, completionShown: true, detail: String(event.detail || '')},
      showCompletion: true,
    }
  }
  return {state: {...eventState, phase, detail: String(event.detail || '')}, showCompletion: false}
}
