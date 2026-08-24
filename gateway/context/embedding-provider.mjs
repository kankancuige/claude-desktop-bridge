function providerError(message, code, cause = null) {
    return Object.assign(new Error(message), {code, ...(cause ? {cause} : {})})
}

function safeEndpoint(value) {
    const raw = String(value || '').trim()
    if (!raw) return null
    let url
    try { url = new URL(raw) } catch (error) { throw providerError('embedding endpoint 无效', 'EMBEDDING_ENDPOINT_INVALID', error) }
    if (!['http:', 'https:'].includes(url.protocol)) throw providerError('embedding endpoint 协议无效', 'EMBEDDING_ENDPOINT_INVALID')
    return url.toString()
}

function dimensionsValue(value) {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4096) throw providerError('embedding 维度无效', 'EMBEDDING_DIMENSIONS_INVALID')
    return parsed
}

function boundedTimeout(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(1000, Math.min(120000, Math.trunc(parsed))) : 15000
}

function validateEmbedding(value, dimensions) {
    if (!Array.isArray(value) || value.length !== dimensions || value.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
        throw providerError('embedding 响应维度或数值无效', 'EMBEDDING_RESPONSE_INVALID')
    }
    return value.map(Number)
}

export function createEmbeddingProvider({endpoint, apiKey = '', model = 'text-embedding-3-small', dimensions = 1536, timeoutMs = 15000, fetchImpl = globalThis.fetch} = {}) {
    const url = safeEndpoint(endpoint)
    const configuredDimensions = dimensionsValue(dimensions)
    const token = String(apiKey || '').trim()
    if (typeof fetchImpl !== 'function') throw providerError('embedding fetch 不可用', 'EMBEDDING_FETCH_UNAVAILABLE')
    let closed = false
    const embed = async (text, {signal = null} = {}) => {
        if (closed) throw providerError('embedding provider 已关闭', 'EMBEDDING_PROVIDER_CLOSED')
        if (!url) throw providerError('embedding endpoint 未配置', 'EMBEDDING_ENDPOINT_MISSING')
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs))
        const onAbort = () => controller.abort()
        signal?.addEventListener?.('abort', onAbort, {once: true})
        try {
            const headers = {'content-type': 'application/json'}
            if (token) headers.authorization = `Bearer ${token}`
            const response = await fetchImpl(url, {
                method: 'POST', headers,
                body: JSON.stringify({model: String(model || '').slice(0, 200), input: String(text || '')}),
                signal: controller.signal,
            })
            if (!response?.ok) {
                const status = Number(response?.status || 0)
                throw providerError(`embedding provider 返回 HTTP ${status || '错误'}`, status === 429 ? 'EMBEDDING_RATE_LIMITED' : 'EMBEDDING_HTTP_FAILED')
            }
            let payload
            try { payload = await response.json() } catch (error) { throw providerError('embedding provider 返回非 JSON', 'EMBEDDING_RESPONSE_INVALID', error) }
            const vector = payload?.data?.[0]?.embedding ?? payload?.embedding
            return validateEmbedding(vector, configuredDimensions)
        } catch (error) {
            if (error?.name === 'AbortError') throw providerError('embedding provider 超时或已取消', signal?.aborted ? 'EMBEDDING_ABORTED' : 'EMBEDDING_TIMEOUT')
            if (error?.code?.startsWith?.('EMBEDDING_')) throw error
            throw providerError('embedding provider 请求失败', 'EMBEDDING_REQUEST_FAILED', error)
        } finally {
            clearTimeout(timeout)
            signal?.removeEventListener?.('abort', onAbort)
        }
    }
    return {
        name: String(model || '').slice(0, 200),
        dimensions: configuredDimensions,
        configured: Boolean(url),
        embed,
        async health() { return {configured: Boolean(url), dimensions: configuredDimensions, model: String(model || '').slice(0, 200)} },
        close() { closed = true },
    }
}
