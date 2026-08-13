export type ParentTaskPhase = 'idle' | 'running' | 'reviewing' | 'changes_required' | 'fixing' | 'review_paused' | 'succeeded' | 'incomplete' | 'failed'

export interface ParentTaskUiState {
  phase: ParentTaskPhase
  primaryResultSeen: boolean
  completionShown: boolean
  detail: string
  taskId: string
  sequence: number
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
