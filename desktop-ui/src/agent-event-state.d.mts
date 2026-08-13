export type AgentCardStatus = 'spawning' | 'running' | 'paused' | 'done' | 'error'

export interface WorkflowAgentState {
  status?: AgentCardStatus
  eventSource?: 'structured' | 'log'
  [key: string]: unknown
}

export function normalizeWorkflowLogAgentStatus(status: unknown): AgentCardStatus
export function mergeWorkflowAgentLogState<T extends WorkflowAgentState>(current: T, logStatus: unknown): T & {
  status?: AgentCardStatus
  eventSource?: 'structured' | 'log'
}
