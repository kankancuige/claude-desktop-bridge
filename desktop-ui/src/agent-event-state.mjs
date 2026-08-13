const VALID_LOG_STATUSES = new Set(['pending', 'running', 'paused', 'done', 'error'])

export function normalizeWorkflowLogAgentStatus(status) {
  if (!VALID_LOG_STATUSES.has(status)) return 'running'
  return status === 'pending' ? 'spawning' : status
}

export function mergeWorkflowAgentLogState(current, logStatus) {
  const state = current && typeof current === 'object' ? current : {}
  if (state.eventSource === 'structured') return {...state}
  const status = normalizeWorkflowLogAgentStatus(logStatus)
  return {
    ...state,
    status,
    eventSource: 'log',
  }
}
