const VALID_MODES = new Set(['auto', 'fixed'])

export function normalizeModelMode(mode) {
  return VALID_MODES.has(mode) ? mode : 'auto'
}

export function buildModelSelectionPayload({mode, model, modelMeta} = {}) {
  const modelMode = normalizeModelMode(mode)
  if (modelMode === 'auto') return {modelMode}
  return {
    modelMode,
    model: typeof model === 'string' ? model : '',
    modelMeta: modelMeta ?? null,
  }
}

const TIER_LABELS = {light: 'Light', balanced: 'Balanced', power: 'Power'}
const RISK_LABELS = {low: '低风险', medium: '中风险', high: '高风险', critical: '关键风险'}

export function describeTaskDecision(decision) {
  if (!decision || typeof decision !== 'object') return ''
  const tier = TIER_LABELS[decision.modelTier] || String(decision.modelTier || 'Balanced')
  const risk = RISK_LABELS[decision.risk] || String(decision.risk || '未知风险')
  const model = String(decision.model || '').trim()
  const mode = decision.modelMode === 'fixed' ? '固定' : '自动'
  const fallback = decision.fallbackReason === 'tier_model_unconfigured' ? '，当前档位未配置，已使用默认模型' : ''
  return `${mode} · ${tier} · ${risk}${model ? ` · ${model}` : ''}${fallback}`
}
