export type TaskOutcome = 'succeeded' | 'incomplete' | 'failed'
export type ContinuationReason = 'max_turns' | 'max_budget' | 'execution_error' | 'structured_output' | 'unknown_error' | null

export interface RawTaskResult {
  subtype?: string
  is_error?: boolean
  outcome?: TaskOutcome
  continuationReason?: ContinuationReason
  resumable?: boolean
}
export interface TaskResultPresentation {
  outcome: TaskOutcome
  continuationReason: ContinuationReason
  resumable: boolean
  tone: 'success' | 'warning' | 'error'
  messageKey: 'sys.done' | 'sys.incompleteMaxTurns' | 'sys.maxBudget' | 'sys.executionFailed'
}

function fallbackReason(subtype: string): ContinuationReason {
  if (subtype === 'error_max_turns') return 'max_turns'
  if (subtype === 'error_max_budget_usd') return 'max_budget'
  if (subtype === 'error_during_execution') return 'execution_error'
  if (subtype === 'error_max_structured_output_retries') return 'structured_output'
  return 'unknown_error'
}

export function normalizeTaskResult(raw: RawTaskResult = {}): TaskResultPresentation {
  const subtype = String(raw.subtype || '')
  const succeeded = raw.outcome === 'succeeded' || (subtype === 'success' && raw.is_error !== true)
  if (succeeded) {
    return {outcome: 'succeeded', continuationReason: null, resumable: false, tone: 'success', messageKey: 'sys.done'}
  }

  const continuationReason = raw.continuationReason || fallbackReason(subtype)
  if (continuationReason === 'max_turns') {
    return {
      outcome: 'incomplete',
      continuationReason,
      resumable: raw.resumable === true,
      tone: 'warning',
      messageKey: 'sys.incompleteMaxTurns',
    }
  }
  if (continuationReason === 'max_budget') {
    return {outcome: 'failed', continuationReason, resumable: false, tone: 'warning', messageKey: 'sys.maxBudget'}
  }
  return {
    outcome: 'failed',
    continuationReason,
    resumable: raw.resumable === true,
    tone: 'error',
    messageKey: 'sys.executionFailed',
  }
}

export function buildContinuationPrompt({originalTask, reason}: {originalTask: string, reason: ContinuationReason}): string {
  const goal = String(originalTask || '').trim() || '当前会话中尚未完成的任务'
  const interruption = reason === 'max_turns'
    ? '上一执行片段达到单次最大轮数'
    : '上一执行片段异常中断'
  return [
    '继续执行同一个未完成任务，不要把本消息当成新的独立需求。',
    `原始任务：${goal}`,
    `中断原因：${interruption}。`,
    '先根据当前会话记录和工作区状态确认已经完成的修改，不要重复执行已有副作用。',
    '继续完成剩余实现，并执行尚未完成的构建、测试或运行验证；只有验证闭环后才能报告完成。',
  ].join('\n')
}
