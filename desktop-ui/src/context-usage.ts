export type ContextUiState = 'normal' | 'warning' | 'compacting' | 'unknown'

export interface ContextUiUsage {
  totalTokens: number
  maxTokens: number | null
  rawMaxTokens: number | null
  percentage: number | null
  state: ContextUiState
}

export function contextPercentFromTokens(totalTokens: unknown, maxTokens: unknown): number | null {
  const toNumber = (value: unknown) => {
    if (typeof value === 'number') return value
    if (typeof value !== 'string') return Number(value)
    const match = /^(\d+(?:\.\d+)?)\s*(K|M|B)?$/i.exec(value.trim().replace(/,/g, ''))
    if (!match) return Number(value)
    const multiplier = match[2]?.toUpperCase() === 'B' ? 1e9 : match[2]?.toUpperCase() === 'M' ? 1e6 : match[2]?.toUpperCase() === 'K' ? 1e3 : 1
    return Number(match[1]) * multiplier
  }
  const total = toNumber(totalTokens)
  const max = toNumber(maxTokens)
  if (!Number.isFinite(total) || !Number.isFinite(max) || max <= 0) return null
  return Math.max(0, Math.min(100, Math.round(Math.max(0, total) / max * 100)))
}

export function normalizeContextUiState(raw: any): ContextUiUsage {
  const totalRaw = raw?.totalTokens ?? raw?.total_tokens
  const maxRaw = raw?.maxTokens ?? raw?.max_tokens
  const rawMaxRaw = raw?.rawMaxTokens ?? raw?.raw_max_tokens
  const parseValue = (value: unknown) => {
    if (typeof value === 'number') return value
    if (typeof value !== 'string') return Number(value)
    const match = /^(\d+(?:\.\d+)?)\s*(K|M|B)?$/i.exec(value.trim().replace(/,/g, ''))
    if (!match) return Number(value)
    const multiplier = match[2]?.toUpperCase() === 'B' ? 1e9 : match[2]?.toUpperCase() === 'M' ? 1e6 : match[2]?.toUpperCase() === 'K' ? 1e3 : 1
    return Number(match[1]) * multiplier
  }
  const totalNumber = parseValue(totalRaw)
  const maxNumber = parseValue(maxRaw)
  const rawMaxNumber = parseValue(rawMaxRaw)
  const totalTokens = Number.isFinite(totalNumber) ? Math.max(0, Math.round(totalNumber)) : 0
  const rawMaxCandidate = Number.isFinite(rawMaxNumber) && rawMaxNumber > 0 ? Math.round(rawMaxNumber) : null
  // SDK 的 get_context_usage 只返回 raw_max_tokens；没有 max_tokens 时仍应显示圆环。
  const actualMaxTokens = Number.isFinite(maxNumber) && maxNumber > 0
    ? Math.round(maxNumber) : rawMaxCandidate
  const configuredNumber = parseValue(raw?.configuredSafetyCap)
  const configuredSafetyCap = Number.isFinite(configuredNumber) && configuredNumber > 0
    ? Math.round(configuredNumber) : null
  const maxTokens = actualMaxTokens === null ? null : configuredSafetyCap ? Math.min(actualMaxTokens, configuredSafetyCap) : actualMaxTokens
  const rawMaxTokens = rawMaxCandidate || maxTokens
  const calculatedPercentage = contextPercentFromTokens(totalTokens, maxTokens)
  const percentage = Number.isFinite(Number(raw?.percentage)) && maxTokens !== null && maxTokens === actualMaxTokens
    ? Math.max(0, Math.min(100, Math.round(Number(raw.percentage))))
    : calculatedPercentage
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
