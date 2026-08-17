export type ContextUiState = 'normal' | 'warning' | 'compacting' | 'unknown'

export interface ContextUiUsage {
  totalTokens: number
  maxTokens: number | null
  rawMaxTokens: number | null
  percentage: number | null
  state: ContextUiState
}

export function normalizeContextUiState(raw: any): ContextUiUsage {
  const totalTokens = Number.isFinite(Number(raw?.totalTokens)) ? Math.max(0, Math.round(Number(raw.totalTokens))) : 0
  const actualMaxTokens = Number.isFinite(Number(raw?.maxTokens)) && Number(raw.maxTokens) > 0 ? Math.round(Number(raw.maxTokens)) : null
  const configuredSafetyCap = Number.isFinite(Number(raw?.configuredSafetyCap)) && Number(raw.configuredSafetyCap) > 0
    ? Math.round(Number(raw.configuredSafetyCap)) : null
  const maxTokens = actualMaxTokens === null ? null : configuredSafetyCap ? Math.min(actualMaxTokens, configuredSafetyCap) : actualMaxTokens
  const rawMaxTokens = Number.isFinite(Number(raw?.rawMaxTokens)) && Number(raw.rawMaxTokens) > 0
    ? Math.round(Number(raw.rawMaxTokens)) : maxTokens
  const percentage = Number.isFinite(Number(raw?.percentage)) && maxTokens !== null && maxTokens === actualMaxTokens
    ? Math.max(0, Math.min(100, Math.round(Number(raw.percentage))))
    : maxTokens === null ? null : Math.min(100, Math.round(totalTokens / maxTokens * 100))
  return {
    totalTokens,
    maxTokens,
    rawMaxTokens,
    percentage,
    state: percentage === null ? 'unknown' : percentage >= 90 ? 'warning' : 'normal',
  }
}

export function formatCompactSummary({preTokens = 0, postTokens = 0, durationMs = 0}: any): string {
  const formatTokens = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : `${(value / 1_000).toFixed(1)}K`
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const duration = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`
  return `${formatTokens(preTokens)} → ${formatTokens(postTokens)} · ${duration}`
}

export function isSyntheticCompactUiMessage(raw: any): boolean {
  if (raw?.isCompactSummary === true || raw?.isVisibleInTranscriptOnly === true
    || raw?.message?.isCompactSummary === true || raw?.message?.isVisibleInTranscriptOnly === true) return true
  const content = raw?.message?.content ?? raw?.text ?? raw?.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter(block => block?.type === 'text').map(block => block.text || '').join('\n')
      : ''
  return /^\s*(?:This session is being continued(?: from a previous conversation that ran out of context)?\.?|The conversation has been compacted|Context compacted)/i.test(text)
}
