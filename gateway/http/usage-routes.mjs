function json(res, status, body) {
    res.writeHead(status, {'Content-Type': 'application/json'})
    res.end(JSON.stringify(body))
}

function numeric(value, fallback = null) {
    if (value == null || String(value).trim() === '') return fallback
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function publicEvent(row) {
    if (!row || typeof row !== 'object') return null
    return {
        eventId: String(row.eventId || '').slice(0, 240),
        projectKey: row.projectKey ? String(row.projectKey).slice(0, 240) : null,
        sessionId: row.sessionId ? String(row.sessionId).slice(0, 240) : null,
        model: row.model ? String(row.model).slice(0, 240) : '未知模型',
        providerKey: row.providerKey ? String(row.providerKey).slice(0, 96) : null,
        inputTokens: numeric(row.inputTokens),
        outputTokens: numeric(row.outputTokens),
        cacheReadInputTokens: numeric(row.cacheReadInputTokens),
        cacheCreationInputTokens: numeric(row.cacheCreationInputTokens),
        source: row.source ? String(row.source).slice(0, 40) : 'unknown',
        durationMs: numeric(row.durationMs),
        retryCount: numeric(row.retryCount, 0),
        createdAt: numeric(row.createdAt, Date.now()),
        status: ['pending', 'completed', 'failed', 'cancelled'].includes(row.status) ? row.status : 'completed',
        endedAt: numeric(row.endedAt),
        errorCode: row.errorCode ? String(row.errorCode).slice(0, 120) : null,
    }
}

function publicSummary(summary = {}) {
    return {
        eventCount: numeric(summary.eventCount, 0),
        unknownTokenEvents: numeric(summary.unknownTokenEvents, 0),
        inputTokens: numeric(summary.inputTokens),
        outputTokens: numeric(summary.outputTokens),
        cacheReadInputTokens: numeric(summary.cacheReadInputTokens),
        cacheCreationInputTokens: numeric(summary.cacheCreationInputTokens),
    }
}

function publicTrend(rows = []) {
    return (Array.isArray(rows) ? rows : []).slice(0, 31).map(row => ({
        day: String(row.day || '').slice(0, 10),
        eventCount: numeric(row.eventCount, 0),
        inputTokens: numeric(row.inputTokens, 0),
        outputTokens: numeric(row.outputTokens, 0),
        cacheReadInputTokens: numeric(row.cacheReadInputTokens, 0),
        cacheCreationInputTokens: numeric(row.cacheCreationInputTokens, 0),
    })).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.day))
}

function limit(value, fallback = 100) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.trunc(parsed))) : fallback
}

export function hasActiveAiWork(session) {
    return Boolean(session && (
        session._generating
        || session.activeTurnId
        || session._rebuildPromise
        || session._pendingInputs?.length
        || session._pendingMessages?.length
    ))
}

/** 设置页模型用量查询；只返回脱敏统计，不返回 prompt、凭据或文件路径。 */
export function createUsageRoutes({getUsageStore, getSessions, getState} = {}) {
    return async function handleUsageRoute({req, res, url} = {}) {
        if (req.method !== 'GET' || url.pathname !== '/api/usage/history') return false
        const store = getUsageStore?.()
        if (!store?.listModelUsageHistory || !store?.summarizeModelUsage) {
            json(res, 503, {error: 'usage_store_unavailable', events: [], trend: [], summary: null, activeSessions: {active: false, count: 0}})
            return true
        }
        try {
            const from = url.searchParams.get('from')
            const to = url.searchParams.get('to')
            const projectKey = String(url.searchParams.get('projectKey') || '').trim() || null
            const options = {from: numeric(from), to: numeric(to), projectKey, limit: limit(url.searchParams.get('limit'))}
            const [summary, events] = await Promise.all([
                Promise.resolve(store.summarizeModelUsage(options)),
                Promise.resolve(store.listModelUsageHistory(options)),
            ])
            const active = [...(getSessions?.() || new Map()).values()].filter(hasActiveAiWork).length
            json(res, 200, {
                summary: publicSummary(summary?.totals),
                trend: publicTrend(summary?.trend),
                events: (Array.isArray(events) ? events : []).map(publicEvent).filter(Boolean),
                window: {from: numeric(summary?.from), to: numeric(summary?.to)},
                activeSessions: {active: active > 0, count: active},
                stateStoreDegraded: Boolean(getState?.()?.degraded),
            })
        } catch (error) {
            json(res, 503, {error: String(error?.code || error?.message || 'usage_query_failed').slice(0, 160), events: [], trend: [], summary: null, activeSessions: {active: false, count: 0}})
        }
        return true
    }
}
