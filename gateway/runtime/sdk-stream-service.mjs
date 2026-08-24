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

    function recordProviderUsage(sessionId, session, sdkMsg) {
        const event = createModelUsageEvent({
            eventId: randomId(),
            sessionId,
            projectKey: getSessionProjectKey(session?.workDir),
            envelope: session?.contextEnvelope || createSessionContextEnvelope(session),
            policy: session?._lastContextReusePolicy || {
                mode: 'reuse_same_session', cacheEligibility: 'unknown', reasonCodes: ['usage_policy_unavailable'],
            },
            usage: sdkMsg?.usage,
            durationMs: sdkMsg?.duration_ms,
            retryCount: sdkMsg?.retry_count,
        })
        try {
            const persisted = getStateStore()?.appendModelUsageEvent?.(event) || false
            broadcast(sessionId, {
                type: 'model_usage_observed',
                model: event.model,
                source: event.source,
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
                cacheReadInputTokens: event.cacheReadInputTokens,
                cacheCreationInputTokens: event.cacheCreationInputTokens,
                cacheEligibility: event.cacheEligibility,
                policy: event.policy,
                persisted,
            })
            return {event, persisted}
        } catch (error) {
            logger.warn({err: error, sessionId: sessionId?.slice?.(0, 8)}, 'Provider usage 脱敏账本写入失败')
            return {event, persisted: false, error}
        }
    }

    function maybeRefreshContextUsage(sessionId, session, reason) {
        if (!session?.query || typeof session.query.getContextUsage !== 'function') return
        const timestamp = now()
        if (timestamp - Number(session._lastContextUsageAt || 0) < timeoutMs) return
        session._lastContextUsageAt = timestamp
        void refreshContextUsage(sessionId, session, reason)
    }

    return {refreshContextUsage, recordProviderUsage, maybeRefreshContextUsage}
}
