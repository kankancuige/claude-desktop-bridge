const UNKNOWN_PROFILE = Object.freeze({
    id: 'unknown',
    sameSessionResume: 'unknown',
    streamCancellation: 'unknown',
    cacheUsage: 'unknown',
    crossModelContext: 'cross_model_unavailable',
})

const PROFILES = Object.freeze({
    'codex-relay': Object.freeze({
        id: 'codex-relay', sameSessionResume: 'provider_dependent',
        streamCancellation: 'best_effort', cacheUsage: 'provider_observed',
        crossModelContext: 'cross_model_unavailable',
    }),
    deepseek: Object.freeze({
        id: 'deepseek', sameSessionResume: 'provider_dependent',
        streamCancellation: 'best_effort', cacheUsage: 'provider_observed',
        crossModelContext: 'cross_model_unavailable',
    }),
    opencode: Object.freeze({
        id: 'opencode', sameSessionResume: 'provider_dependent',
        streamCancellation: 'best_effort', cacheUsage: 'unknown',
        crossModelContext: 'cross_model_unavailable',
    }),
})

function normalized(value) { return typeof value === 'string' ? value.trim().toLowerCase() : '' }

/** 只返回能力边界，不把 Provider 的 resume 或缓存能力推断为已验证事实。 */
export function resolveProviderCapabilityProfile(baseUrl = '') {
    const value = normalized(baseUrl)
    if (/codex|aicodemirror|claudecode\.net\.cn/.test(value)) return PROFILES['codex-relay']
    if (/deepseek/.test(value)) return PROFILES.deepseek
    if (/opencode/.test(value)) return PROFILES.opencode
    return UNKNOWN_PROFILE
}

export {PROFILES, UNKNOWN_PROFILE}
