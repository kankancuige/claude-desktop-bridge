import crypto from 'node:crypto'
import {createSessionContextEnvelope} from '../sessions/session-runtime.mjs'
import {contextUsageEvent, parseTokenCount} from '../context/context-lifecycle.mjs'
import {createModelUsageEvent} from '../context/model-usage.mjs'

/**
 * SDK 流副作用服务。
 *
 * 流泵只负责消费 SDK 消息；上下文采样和 usage 账本通过此服务访问外部
 * 状态，所有依赖均由组合根注入，避免在消息循环内隐式捕获数据库对象。
 */
export function createSdkStreamService({
    withTimeout,
    timeoutMs = 5_000,
    getStateStore = () => null,
    getSessionProjectKey = workDir => workDir || '',
    broadcast,
    logger = {debug() {}, warn() {}},
    now = () => Date.now(),
    randomId = () => crypto.randomUUID(),
} = {}) {
    if (typeof withTimeout !== 'function') throw new TypeError('withTimeout is required')
    if (typeof broadcast !== 'function') throw new TypeError('broadcast is required')

    async function refreshContextUsage(sessionId, session, reason) {
        if (!session?.query || typeof session.query.getContextUsage !== 'function') return null
        if (session._contextUsageInFlight) return session._contextUsageInFlight
        session._contextUsageInFlight = (async () => {
            try {
                const usage = await withTimeout(Promise.resolve(session.query.getContextUsage()), timeoutMs)
                const configuredThreshold = parseTokenCount(session.queryOpts?.settings?.autoCompactWindow)
                const event = contextUsageEvent(usage, {
                    reason,
                    ...(configuredThreshold ? {autoCompactThreshold: configuredThreshold} : {}),
                })
                session.contextUsage = event
                broadcast(sessionId, event)
                return event
            } catch (error) {
                logger.debug({err: error, sessionId: sessionId?.slice?.(0, 8), reason}, 'SDK 上下文用量读取失败')
                return null
            } finally {
                session._contextUsageInFlight = null
            }
        })()
        return session._contextUsageInFlight
    }

    function buildUsageEvent(sessionId, session, sdkMsg, {status = 'completed', eventId = null, endedAt = null, errorCode = null} = {}) {
        const event = createModelUsageEvent({
            eventId: eventId || randomId(),
            sessionId,
            projectKey: getSessionProjectKey(session?.workDir),
            envelope: session?.contextEnvelope || createSessionContextEnvelope(session),
            policy: session?._lastContextReusePolicy || {
                mode: 'reuse_same_session', cacheEligibility: 'unknown', reasonCodes: ['usage_policy_unavailable'],
            },
            usage: sdkMsg?.usage,
            durationMs: sdkMsg?.duration_ms,
            retryCount: sdkMsg?.retry_count,
            status,
            endedAt,
            errorCode,
        })
        return event
    }

    function broadcastUsage(sessionId, event, persisted) {
        broadcast(sessionId, {
            type: 'model_usage_observed', eventId: event.eventId, status: event.status,
            model: event.model, source: event.source, inputTokens: event.inputTokens,
            outputTokens: event.outputTokens, cacheReadInputTokens: event.cacheReadInputTokens,
            cacheCreationInputTokens: event.cacheCreationInputTokens,
            cacheEligibility: event.cacheEligibility, policy: event.policy, persisted,
            endedAt: event.endedAt, errorCode: event.errorCode,
        })
    }

    function recordProviderUsage(sessionId, session, sdkMsg) {
        const event = buildUsageEvent(sessionId, session, sdkMsg)
        try {
            const persisted = getStateStore()?.appendModelUsageEvent?.(event) || false
            broadcastUsage(sessionId, event, persisted)
            return {event, persisted}
        } catch (error) {
            logger.warn({err: error, sessionId: sessionId?.slice?.(0, 8)}, 'Provider usage 脱敏账本写入失败')
            return {event, persisted: false, error}
        }
    }

    async function beginProviderUsage(sessionId, session, sdkMsg = {}) {
        if (session?._activeModelUsageEventId) return session._activeModelUsageEventId
        const event = buildUsageEvent(sessionId, session, sdkMsg, {status: 'pending'})
        session._activeModelUsageEventId = event.eventId
        session._activeModelUsageStartedAt = event.createdAt
        session._finishModelUsage = (status = 'failed', errorCode = 'stream_error') => finishProviderUsage(sessionId, session, {usage: undefined, duration_ms: Math.max(0, now() - Number(session._activeModelUsageStartedAt || now()))}, status, errorCode)
        try {
            const result = getStateStore()?.appendModelUsageEvent?.(event)
            const persisted = result && typeof result.then === 'function' ? await result : result
            broadcastUsage(sessionId, event, Boolean(persisted))
        } catch (error) {
            logger.warn({err: error, sessionId: sessionId?.slice?.(0, 8)}, 'Provider usage 开始账本写入失败')
        }
        return event.eventId
    }

    async function finishProviderUsage(sessionId, session, sdkMsg, status = 'completed', errorCode = null) {
        const eventId = session?._activeModelUsageEventId
        if (!eventId) return recordProviderUsage(sessionId, session, sdkMsg)
        const endedAt = now()
        const event = buildUsageEvent(sessionId, session, sdkMsg, {status, eventId, endedAt, errorCode})
        try {
            const store = getStateStore?.()
            const result = store?.updateModelUsageEvent?.(eventId, event)
            const persisted = result && typeof result.then === 'function' ? await result : result
            broadcastUsage(sessionId, event, Boolean(persisted))
            return {event, persisted: Boolean(persisted)}
        } catch (error) {
            logger.warn({err: error, sessionId: sessionId?.slice?.(0, 8)}, 'Provider usage 结束账本更新失败')
            return {event, persisted: false, error}
        } finally {
            session._activeModelUsageEventId = null
            session._activeModelUsageStartedAt = 0
            session._finishModelUsage = null
        }
    }

    async function failProviderUsage(sessionId, session, errorCode = 'stream_error', status = 'failed') {
        if (!session?._activeModelUsageEventId) return null
        return finishProviderUsage(sessionId, session, {usage: undefined, duration_ms: Math.max(0, now() - Number(session._activeModelUsageStartedAt || now()))}, status, errorCode)
    }

    function maybeRefreshContextUsage(sessionId, session, reason) {
        if (!session?.query || typeof session.query.getContextUsage !== 'function') return
        const timestamp = now()
        if (timestamp - Number(session._lastContextUsageAt || 0) < timeoutMs) return
        session._lastContextUsageAt = timestamp
        void refreshContextUsage(sessionId, session, reason)
    }

    return {refreshContextUsage, recordProviderUsage, beginProviderUsage, finishProviderUsage, failProviderUsage, maybeRefreshContextUsage}
}
