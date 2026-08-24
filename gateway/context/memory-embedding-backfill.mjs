function errorWithCode(message, code, cause = null) {
    return Object.assign(new Error(message), {code, ...(cause ? {cause} : {})})
}

function required(value, name) {
    const result = String(value || '').trim()
    if (!result) throw errorWithCode(`${name} is required`, 'MEMORY_BACKFILL_ARGUMENT_INVALID')
    return result
}

function abortError() {
    return errorWithCode('Memory embedding 回填已取消', 'MEMORY_BACKFILL_ABORTED')
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError()
}

function retryable(error) {
    return ['EMBEDDING_RATE_LIMITED', 'EMBEDDING_HTTP_FAILED', 'EMBEDDING_REQUEST_FAILED', 'EMBEDDING_TIMEOUT'].includes(String(error?.code || ''))
}

function wait(delayMs, signal) {
    throwIfAborted(signal)
    return new Promise((resolve, reject) => {
        let settled = false
        const timer = setTimeout(() => {
            settled = true
            signal?.removeEventListener('abort', onAbort)
            resolve()
        }, delayMs)
        const onAbort = () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
            reject(abortError())
        }
        signal?.addEventListener('abort', onAbort, {once: true})
    })
}

async function embedWithRetry({provider, body, signal, retry}) {
    const attempts = Math.max(1, Math.min(10, Number(retry.attempts) || 3))
    const baseDelayMs = Math.max(0, Math.min(5000, Number(retry.baseDelayMs) || 100))
    const maxDelayMs = Math.max(baseDelayMs, Math.min(30000, Number(retry.maxDelayMs) || 400))
    let attempt = 0
    while (true) {
        throwIfAborted(signal)
        try {
            return await provider.embed(body, {signal})
        } catch (error) {
            if (signal?.aborted || error?.code === 'EMBEDDING_ABORTED') throw abortError()
            attempt++
            if (!retryable(error) || attempt >= attempts) throw error
            const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)))
            await wait(delay, signal)
        }
    }
}

function cursorFor(row) {
    return {updatedAt: Number(row.updatedAt), sourceKey: String(row.sourceKey)}
}

/**
 * 批量生成 Memory embedding。游标只推进已扫描内容，失败项可通过返回的 checkpoint 重试。
 */
export async function runMemoryEmbeddingBackfill({contentStore, embeddingProvider, projectKey, embeddingModel, batchSize = 25, dryRun = false, signal = null, checkpoint = null, retry = {}, failureLimit = 50} = {}) {
    if (!contentStore?.list || !contentStore?.getEmbedding || (!dryRun && !contentStore?.putEmbedding)) throw errorWithCode('Memory content repository 不完整', 'MEMORY_BACKFILL_STORAGE_REQUIRED')
    const project = required(projectKey, 'projectKey')
    const model = required(embeddingModel, 'embeddingModel')
    if (!dryRun && typeof embeddingProvider?.embed !== 'function') throw errorWithCode('embedding provider 未配置', 'MEMORY_BACKFILL_PROVIDER_REQUIRED')
    const size = Math.max(1, Math.min(500, Number(batchSize) || 25))
    const failures = []
    let scanned = 0
    let eligible = 0
    let embedded = 0
    let skipped = 0
    let failed = 0
    let cancelled = false
    let after = checkpoint?.sourceKey != null ? {updatedAt: checkpoint.updatedAt, sourceKey: checkpoint.sourceKey} : null

    try {
        while (true) {
            throwIfAborted(signal)
            const rows = await contentStore.list({projectKey: project, kind: 'memory', status: 'active', limit: size, after})
            if (!rows.length) break
            for (const row of rows) {
                throwIfAborted(signal)
                scanned++
                after = cursorFor(row)
                const body = typeof row.body === 'string' ? row.body : ''
                const bodyHash = String(row.bodyHash || '')
                if (!bodyHash || !body) {
                    failed++
                    if (failures.length < failureLimit) failures.push({sourceKey: String(row.sourceKey || ''), code: 'MEMORY_BACKFILL_CONTENT_INVALID'})
                    continue
                }
                eligible++
                const existing = await contentStore.getEmbedding({projectKey: project, sourceKey: row.sourceKey, bodyHash, embeddingModel: model})
                if (existing?.status === 'ready') {
                    skipped++
                    continue
                }
                if (dryRun) continue
                try {
                    const embedding = await embedWithRetry({provider: embeddingProvider, body, signal, retry})
                    await contentStore.putEmbedding({projectKey: project, sourceKey: row.sourceKey, bodyHash, embeddingModel: model, embedding})
                    embedded++
                } catch (error) {
                    if (error?.code === 'MEMORY_BACKFILL_ABORTED') throw error
                    failed++
                    if (failures.length < failureLimit) failures.push({sourceKey: String(row.sourceKey || ''), code: error?.code || 'MEMORY_BACKFILL_FAILED'})
                }
            }
            if (rows.length < size) break
        }
    } catch (error) {
        if (error?.code !== 'MEMORY_BACKFILL_ABORTED') throw error
        cancelled = true
    }
    return {
        status: cancelled ? 'cancelled' : failed > 0 ? 'failed' : 'completed',
        scanned, eligible, embedded, skipped, failed, cancelled,
        nextCheckpoint: after,
        failures,
    }
}
