export function maskAdapterUserId(userId) {
    const value = String(userId || '')
    if (!value) return ''
    if (value.length <= 4) return '•'.repeat(value.length)
    return `${value.slice(0, 2)}${'•'.repeat(Math.min(8, value.length - 4))}${value.slice(-2)}`
}

export function normalizeAdapterBindings(input, allowedPlatforms = []) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
    const allowed = new Set(allowedPlatforms)
    const normalized = {}
    for (const [key, value] of Object.entries(input)) {
        if (!value || typeof value !== 'object') continue
        const platform = String(value.platform || '')
        const userId = String(value.userId || '')
        const sessionId = String(value.sessionId || '')
        if (!allowed.has(platform) || !userId || !sessionId || key !== `${platform}:${userId}`) continue
        normalized[key] = {
            ...value,
            platform,
            userId,
            sessionId,
            updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
        }
    }
    return normalized
}

export function listAdapterBindings(input, {allowedPlatforms = [], isSessionActive = () => false} = {}) {
    const bindings = normalizeAdapterBindings(input, allowedPlatforms)
    return Object.values(bindings)
        .map((binding) => ({
            platform: binding.platform,
            userId: maskAdapterUserId(binding.userId),
            sessionId: binding.sessionId,
            boundAt: binding.updatedAt || null,
            active: !!isSessionActive(binding.sessionId),
        }))
        .sort((a, b) => Number(b.boundAt || 0) - Number(a.boundAt || 0))
}

export function findLatestAdapterUserForSession(input, platform, sessionId) {
    let latest = null
    for (const binding of Object.values(input || {})) {
        if (!binding || binding.platform !== platform || binding.sessionId !== sessionId || !binding.userId) continue
        if (!latest || Number(binding.updatedAt || 0) > Number(latest.updatedAt || 0)) latest = binding
    }
    return latest?.userId || null
}

export function upsertAdapterBinding(input, binding, allowedPlatforms = []) {
    const bindings = normalizeAdapterBindings(input, allowedPlatforms)
    const platform = String(binding?.platform || '')
    const userId = String(binding?.userId || '')
    const sessionId = String(binding?.sessionId || '')
    if (!allowedPlatforms.includes(platform) || !userId || !sessionId) throw new TypeError('adapter binding is invalid')
    bindings[`${platform}:${userId}`] = {...binding, platform, userId, sessionId}
    return bindings
}

export function removeAdapterBindings(input, predicate, allowedPlatforms = []) {
    const bindings = normalizeAdapterBindings(input, allowedPlatforms)
    let deleted = 0
    for (const [key, binding] of Object.entries(bindings)) {
        if (!predicate(binding)) continue
        delete bindings[key]
        deleted++
    }
    return {bindings, deleted}
}
