export type ComposerTaskAction = 'pause' | 'continue' | 'send' | 'disabled'

export interface PausedTaskState {
  status?: unknown
  resumable?: unknown
}

export interface ComposerTaskActionInput {
  busy?: unknown
  canContinue?: unknown
  taskState?: PausedTaskState | null
  text?: unknown
  attachmentCount?: unknown
}

const PAUSED_TASK_STATUSES = new Set(['failed', 'stopped', 'interrupted', 'incomplete', 'review_paused'])

export function isPausedTaskState(taskState: PausedTaskState | null | undefined): boolean {
  const status = String(taskState?.status || '')
  return PAUSED_TASK_STATUSES.has(status)
}

export function resolveComposerTaskAction(input: ComposerTaskActionInput = {}): ComposerTaskAction {
  const hasInput = String(input.text || '').trim().length > 0 || Number(input.attachmentCount || 0) > 0
  if (hasInput) return 'send'
  if (input.busy === true) return 'pause'
  // 生命周期快照是 Gateway 的权威能力来源；旧协议或 Coordinator 等待用户时，
  // taskState 可能尚未投影为标准终态，但仍必须显示统一的继续入口。
  if (input.canContinue === true || isPausedTaskState(input.taskState)) return 'continue'
  return 'disabled'
}
