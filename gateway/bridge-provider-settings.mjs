export const BRIDGE_PROVIDER_ENV_KEYS = Object.freeze([
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_MODEL',
])

function stringValue(value) {
    return typeof value === 'string' ? value.trim() : ''
}

export function normalizeBridgeProviderSettings(input) {
    const env = input?.env && typeof input.env === 'object' && !Array.isArray(input.env) ? input.env : {}
    const authToken = stringValue(env.ANTHROPIC_AUTH_TOKEN)
    const apiKey = stringValue(env.ANTHROPIC_API_KEY)
    return {
        model: stringValue(input?.model),
        env: {
            ANTHROPIC_BASE_URL: stringValue(env.ANTHROPIC_BASE_URL),
            ANTHROPIC_AUTH_TOKEN: authToken || apiKey,
        },
    }
}

export function hasBridgeProviderSettings(input) {
    const normalized = normalizeBridgeProviderSettings(input)
    return Boolean(normalized.model || normalized.env.ANTHROPIC_BASE_URL || normalized.env.ANTHROPIC_AUTH_TOKEN)
}

export function overlayBridgeProviderSettings(settings, provider) {
    if (!provider) return settings
    const result = {...(settings && typeof settings === 'object' ? settings : {})}
    result.env = {...(result.env && typeof result.env === 'object' ? result.env : {})}
    if (typeof provider.model === 'string') result.model = provider.model
    if (typeof provider.env?.ANTHROPIC_BASE_URL === 'string') {
        result.env.ANTHROPIC_BASE_URL = provider.env.ANTHROPIC_BASE_URL
    }
    if (typeof provider.env?.ANTHROPIC_AUTH_TOKEN === 'string') {
        result.env.ANTHROPIC_AUTH_TOKEN = provider.env.ANTHROPIC_AUTH_TOKEN
        result.env.ANTHROPIC_API_KEY = provider.env.ANTHROPIC_AUTH_TOKEN
    }
    if (typeof provider.model === 'string') result.env.ANTHROPIC_MODEL = provider.model
    return result
}

export function extractBridgeProviderSettings(settings, existing = null) {
    const source = normalizeBridgeProviderSettings(settings)
    const previous = normalizeBridgeProviderSettings(existing)
    if (source.env.ANTHROPIC_AUTH_TOKEN === '[REDACTED]') {
        source.env.ANTHROPIC_AUTH_TOKEN = previous.env.ANTHROPIC_AUTH_TOKEN
    }
    return source
}
