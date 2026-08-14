const ACTIVE_PARENT_PHASES = new Set(['running', 'reviewing', 'changes_required', 'fixing'])

export interface TaskBusyInput {
  lifecycleActive?: unknown
  lifecycleReceived?: unknown
  status?: unknown
  activityRunning?: unknown
  runningAgentTotal?: unknown
  workflowStatus?: unknown
  parentPhase?: unknown
  flushingQueue?: unknown
}

/** UI 的忙碌状态必须覆盖主回合、最终审查、Workflow 和队列清空阶段。 */
export function isTaskBusy(input: TaskBusyInput = {}): boolean {
  if (input.lifecycleReceived === true) {
    return input.lifecycleActive === true || input.flushingQueue === true
  }
  return input.status === 'thinking'
    || input.activityRunning === true
    || Number(input.runningAgentTotal) > 0
    || input.workflowStatus === 'running'
    || ACTIVE_PARENT_PHASES.has(String(input.parentPhase || ''))
    || input.flushingQueue === true
}
