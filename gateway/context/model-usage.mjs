function normalizeToken(value) {
    const number = typeof value === 'number' ? value : Number(value)
    return Number.isSafeInteger(number) && number >= 0 ? number : null
}

function readUsageField(raw, snakeCase, camelCase) {
    if (!raw || typeof raw !== 'object') return {present: false, value: null}
    if (Object.hasOwn(raw, snakeCase)) return {present: true, value: normalizeToken(raw[snakeCase])}
    if (Object.hasOwn(raw, camelCase)) return {present: true, value: normalizeToken(raw[camelCase])}
    return {present: false, value: null}
}

/** Provider 未返回字段时保留 null，避免把“不知道”显示成零成本或零缓存。 */
export function normalizeProviderUsage(rawUsage) {
    const input = readUsageField(rawUsage, 'input_tokens', 'inputTokens')
    const output = readUsageField(rawUsage, 'output_tokens', 'outputTokens')
    const cacheRead = readUsageField(rawUsage, 'cache_read_input_tokens', 'cacheReadInputTokens')
    const cacheCreation = readUsageField(rawUsage, 'cache_creation_input_tokens', 'cacheCreationInputTokens')
    const baseObserved = input.value !== null || output.value !== null
    const cacheObserved = cacheRead.present || cacheCreation.present
    return {
        inputTokens: input.value,
        outputTokens: output.value,
        cacheReadInputTokens: cacheRead.value,
        cacheCreationInputTokens: cacheCreation.value,
        source: !baseObserved ? 'unknown' : cacheObserved ? 'provider_observed' : 'partial',
    }
}

function safeText(value, length = 240) {
    return typeof value === 'string' ? value.replace(/[\0\r\n]/g, '').slice(0, length) : null
}

function safeReasons(value) {
    return Array.isArray(value)
        ? value.filter(item => typeof item === 'string' && /^[a-z0-9_:-]{1,80}$/i.test(item)).slice(0, 12)
        : []
}

export function createModelUsageEvent({eventId, sessionId, projectKey, envelope, policy, usage, durationMs = null, retryCount = 0, createdAt = Date.now()} = {}) {
    const normalized = normalizeProviderUsage(usage)
    return {
        eventId: safeText(eventId) || null,
        sessionId: safeText(sessionId),
        projectKey: safeText(projectKey),
        model: safeText(envelope?.model),
        providerKey: safeText(envelope?.providerKey),
        contextFingerprint: safeText(envelope?.fingerprint),
        policy: safeText(policy?.mode, 64),
        cacheEligibility: safeText(policy?.cacheEligibility, 64),
        reasonCodes: safeReasons(policy?.reasonCodes),
        durationMs: normalizeToken(durationMs),
        retryCount: normalizeToken(retryCount) ?? 0,
        createdAt: normalizeToken(createdAt) ?? Date.now(),
        ...normalized,
    }
}
