import {normalizeMemoryMetadata} from './memory-layer.mjs'

function required(value, name) {
    const result = String(value || '').trim()
    if (!result) throw Object.assign(new TypeError(`${name} is required`), {code: 'MEMORY_BACKFILL_ARGUMENT_INVALID'})
    return result
}

function limitValue(value, fallback = 25) {
    return Math.max(1, Math.min(100, Math.trunc(Number(value) || fallback)))
}

function abortError() {
    return Object.assign(new Error('Memory 摘要回填已取消'), {code: 'MEMORY_BACKFILL_ABORTED'})
}

function cursorFor(row) {
    return {updatedAt: Number(row.updatedAt || 0), sourceKey: String(row.sourceKey || row.sourcePath || '')}
}

function hasCurrentSummary(row) {
    const metadata = row?.metadata || {}
    return Boolean(metadata.l0 && metadata.l1 && metadata.summaryBodyHash && String(metadata.summaryBodyHash) === String(row.bodyHash || ''))
}

/**
 * 批量回填 Memory 的 L0/L1 元数据。默认不访问外部模型；调用方可注入受控 summarizer。
 */
export async function runMemoryLayerBackfill({memoryRepository, projectKey, summarize = null, batchSize = 25, checkpoint = null, signal = null, dryRun = false} = {}) {
    if (!memoryRepository?.list || !memoryRepository?.put) throw new TypeError('Memory Repository is required')
    const project = required(projectKey, 'projectKey')
    const size = limitValue(batchSize)
    let after = checkpoint && Number.isFinite(Number(checkpoint.updatedAt)) && checkpoint.sourceKey
        ? {updatedAt: Number(checkpoint.updatedAt), sourceKey: String(checkpoint.sourceKey)}
        : null
    let scanned = 0
    let updated = 0
    let skipped = 0
    const failures = []
    let lastProcessed = after

    while (true) {
        if (signal?.aborted) return {status: 'cancelled', scanned, updated, skipped, failed: failures.length, nextCheckpoint: lastProcessed, failures}
        const rows = await memoryRepository.list({projectKey: project, status: 'active', limit: size, after})
        if (!Array.isArray(rows) || rows.length === 0) return {status: failures.length ? 'failed' : 'completed', scanned, updated, skipped, failed: failures.length, nextCheckpoint: null, failures}
        for (const row of rows) {
            if (signal?.aborted) return {status: 'cancelled', scanned, updated, skipped, failed: failures.length, nextCheckpoint: lastProcessed, failures}
            scanned += 1
            const cursor = cursorFor(row)
            try {
                if (hasCurrentSummary(row)) {
                    skipped += 1
                } else {
                    const proposed = typeof summarize === 'function'
                        ? await summarize({body: String(row.body || ''), row})
                        : {}
                    if (signal?.aborted) return {status: 'cancelled', scanned, updated, skipped, failed: failures.length, nextCheckpoint: lastProcessed, failures}
                    const metadata = normalizeMemoryMetadata({... (row.metadata || {}), ...(proposed && typeof proposed === 'object' ? proposed : {}), summaryGenerator: typeof summarize === 'function' ? 'custom' : 'deterministic-v1'}, row.body || '')
                    if (!dryRun) {
                        await memoryRepository.put({
                            projectKey: project,
                            sourceKey: row.sourceKey || row.sourcePath,
                            title: row.title || row.sourceKey || row.sourcePath,
                            body: row.body || '',
                            bodyHash: row.bodyHash,
                            scope: row.scope || 'project',
                            status: row.status || 'active',
                            metadata,
                            updatedAt: row.updatedAt || Date.now(),
                        })
                    }
                    updated += 1
                }
                lastProcessed = cursor
            } catch (error) {
                failures.push({sourceKey: cursor.sourceKey.slice(0, 240), code: error?.code || 'MEMORY_BACKFILL_FAILED', message: String(error?.message || '回填失败').slice(0, 240)})
                return {status: 'failed', scanned, updated, skipped, failed: failures.length, nextCheckpoint: lastProcessed, failures}
            }
        }
        after = lastProcessed
    }
}

export {abortError}
