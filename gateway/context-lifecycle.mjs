const TOKEN_PATTERN = /^(\d+(?:\.\d+)?)\s*(K|M|B)?$/i

export function parseTokenCount(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : null
    if (typeof value !== 'string') return null
    const normalized = value.trim().replace(/,/g, '')
    if (!normalized) return null
    const match = TOKEN_PATTERN.exec(normalized)
    if (!match) return null
    const multiplier = match[2]?.toUpperCase() === 'B' ? 1e9 : match[2]?.toUpperCase() === 'M' ? 1e6 : match[2]?.toUpperCase() === 'K' ? 1e3 : 1
    const result = Math.round(Number(match[1]) * multiplier)
    return Number.isSafeInteger(result) && result > 0 ? result : null
}

export function resolveContextWindow({
    sdkRawMaxTokens,
    sdkContextWindow,
    modelUsageContextWindow,
    providerContextWindow,
    configuredSafetyCap,
} = {}) {
    const candidates = [
        [sdkRawMaxTokens, 'sdk'],
        [sdkContextWindow, 'sdk'],
        [modelUsageContextWindow, 'model_usage'],
        [providerContextWindow, 'provider'],
    ]
    const selected = candidates.map(([value, source]) => [parseTokenCount(value), source]).find(([value]) => value)
    if (!selected) return {actualMaxTokens: null, effectiveMaxTokens: null, source: 'unknown'}
    const [actualMaxTokens, source] = selected
    const safetyCap = parseTokenCount(configuredSafetyCap)
    return {
        actualMaxTokens,
        effectiveMaxTokens: safetyCap ? Math.min(actualMaxTokens, safetyCap) : actualMaxTokens,
        source,
    }
}

export function calculateAutoCompactWindow(actualWindow, configuredSafetyCap) {
    const actual = parseTokenCount(actualWindow)
    if (!actual) return null
    const cap = parseTokenCount(configuredSafetyCap)
    const effective = cap ? Math.min(actual, cap) : actual
    const threshold = Math.floor(effective * 0.9)
    return threshold >= 100000 ? threshold : null
}

export function normalizeContextUsage(raw) {
    const totalTokens = parseTokenCount(raw?.totalTokens) || 0
    const maxTokens = parseTokenCount(raw?.maxTokens)
    const rawMaxTokens = parseTokenCount(raw?.rawMaxTokens) || maxTokens
    const percentage = Number.isFinite(Number(raw?.percentage))
        ? Math.max(0, Math.min(100, Math.round(Number(raw.percentage))))
        : maxTokens ? Math.min(100, Math.round(totalTokens / maxTokens * 100)) : null
    return {
        totalTokens,
        maxTokens,
        rawMaxTokens,
        percentage,
        categories: Array.isArray(raw?.categories) ? raw.categories : [],
    }
}

export function isSyntheticCompactSummary(sdkMsg) {
    if (sdkMsg?.isCompactSummary === true || sdkMsg?.isVisibleInTranscriptOnly === true
        || sdkMsg?.message?.isCompactSummary === true || sdkMsg?.message?.isVisibleInTranscriptOnly === true) return true
    const content = sdkMsg?.message?.content
    const text = typeof content === 'string'
        ? content
        : Array.isArray(content) ? content.filter(block => block?.type === 'text').map(block => block.text || '').join('\n') : ''
    return /^\s*This session is being continued\.\.\./i.test(text)
}

export function compactBoundaryToEvent(sdkMsg) {
    if (sdkMsg?.type !== 'system' || sdkMsg?.subtype !== 'compact_boundary') return null
    const meta = sdkMsg.compact_metadata || {}
    return {
        type: 'context_compacted',
        trigger: meta.trigger === 'manual' ? 'manual' : 'auto',
        preTokens: parseTokenCount(meta.pre_tokens) || 0,
        postTokens: parseTokenCount(meta.post_tokens) || 0,
        durationMs: parseTokenCount(meta.duration_ms) || 0,
    }
}

export function contextUsageEvent(usage, extra = {}) {
    const normalized = normalizeContextUsage(usage)
    return {
        type: 'context_usage',
        ...normalized,
        ...(parseTokenCount(usage?.autoCompactThreshold) ? {autoCompactThreshold: parseTokenCount(usage.autoCompactThreshold)} : {}),
        ...(typeof usage?.isAutoCompactEnabled === 'boolean' ? {isAutoCompactEnabled: usage.isAutoCompactEnabled} : {}),
        ...(typeof usage?.model === 'string' && usage.model ? {model: usage.model} : {}),
        ...extra,
    }
}
