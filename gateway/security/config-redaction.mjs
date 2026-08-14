export const SECRET_PLACEHOLDER = '[REDACTED]'

export function isSensitiveConfigKey(key) {
    return /(?:^|[_-])(auth|authorization|token|secret|password|passwd|credential|api[_-]?key|private[_-]?key)(?:$|[_-])/i.test(String(key || ''))
        || /^(authorization|cookie|set-cookie|x-api-key)$/i.test(String(key || ''))
}

export function redactSecretMap(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [
        key,
        isSensitiveConfigKey(key) && value !== '' && value != null ? SECRET_PLACEHOLDER : value,
    ]))
}

export function restoreSecretMap(input, existing = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [
        key,
        value === SECRET_PLACEHOLDER && isSensitiveConfigKey(key) && Object.hasOwn(existing || {}, key)
            ? existing[key]
            : value,
    ]))
}

export function restoreSecretValue(value, existing) {
    return value === SECRET_PLACEHOLDER ? existing : value
}
