const ACTIVE_PARENT_PHASES = new Set(['running', 'reviewing', 'changes_required', 'fixing'])
const TERMINAL_PARENT_PHASES = new Set(['succeeded', 'incomplete', 'failed', 'review_paused', 'stopped', 'interrupted'])

export interface TaskBusyInput {
  lifecycleActive?: unknown
  lifecycleReceived?: unknown
  status?: unknown
  activityRunning?: unknown
  runningAgentTotal?: unknown
  workflowStatus?: unknown
  parentPhase?: unknown
  taskStatus?: unknown
  flushingQueue?: unknown
}

/** UI 的忙碌状态必须覆盖主回合、最终审查、Workflow 和队列清空阶段。 */
export function isTaskBusy(input: TaskBusyInput = {}): boolean {
  if ((TERMINAL_PARENT_PHASES.has(String(input.parentPhase || ''))
      || TERMINAL_PARENT_PHASES.has(String(input.taskStatus || '')))
      && input.workflowStatus !== 'running'
      && input.workflowStatus !== 'starting') {
    return input.flushingQueue === true
  }
  if (input.lifecycleReceived === true) {
    // 迟到的旧 lifecycle 快照可能仍带 active=true；父任务已收口且没有运行中的
    // Workflow 时，终态投影优先，避免输入框在“任务已完成”后重新锁死。
    return input.lifecycleActive === true || input.flushingQueue === true
  }
  return input.status === 'thinking'
    || input.activityRunning === true
    || Number(input.runningAgentTotal) > 0
    || input.workflowStatus === 'running'
    || ACTIVE_PARENT_PHASES.has(String(input.parentPhase || ''))
    || input.flushingQueue === true
}
