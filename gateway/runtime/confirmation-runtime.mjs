import {buildAgentToolLifecycleEvent} from '../agents/agent-tool-lifecycle.mjs'

/** 跨桌面端和 IM 适配器的确认请求生命周期。 */
export function createConfirmationRuntime({
    sessions,
    getConfirmHooks = () => [],
    broadcastTurn,
    broadcast,
    shouldRouteMirror,
    logger = {info() {}, debug() {}},
    now = () => Date.now(),
    timeoutMs = 5 * 60 * 1000,
} = {}) {
    if (!sessions || typeof broadcastTurn !== 'function' || typeof broadcast !== 'function'
        || typeof shouldRouteMirror !== 'function') {
        throw new TypeError('confirmation runtime dependencies are required')
    }
    let requestCounter = 0

    function settlePending(sessionId, requestId, result, wonBy) {
        const session = sessions.get(sessionId)
        if (!session) return
        const entry = session.pending?.get(requestId)
        if (!entry || entry.settled) return
        entry.settled = true
        if (entry.timeout) clearTimeout(entry.timeout)
        session.pending.delete(requestId)
        try { entry.resolve(result) } catch (error) { logger.debug({err: error}, '确认结果释放失败') }
        logger.info({
            sessionId: sessionId?.slice(0, 8), requestId, type: entry.type,
            toolName: entry.toolName, decision: result?.behavior || 'unknown',
            wonBy, pendingCount: session.pending.size,
        }, '确认请求已结算')
        broadcastTurn(sessionId, {
            type: 'confirmation_resolved', requestId,
            confirmationType: entry.type, toolName: entry.toolName,
            decision: result?.behavior || 'unknown', wonBy,
            turnId: entry.turnId || null,
        }, entry.userId ? {source: entry.source, userId: entry.userId} : null)
        for (const hook of getConfirmHooks() || []) {
            try { hook.onConfirmResolved?.(sessionId, requestId) }
            catch (error) { logger.debug({err: error}, '确认适配器收口失败') }
        }
    }

    function labelForChoice(entry, questionIndex, optionIndex) {
        return entry.questions?.[questionIndex]?.options?.[optionIndex]?.label ?? String(optionIndex)
    }

    function makeCanUseTool(sessionId) {
        return (toolName, input, {signal, toolUseID} = {}) => new Promise(resolve => {
            const session = sessions.get(sessionId)
            if (!session) {
                resolve({behavior: 'deny', message: 'session 已关闭', interrupt: true})
                return
            }
            const requestId = `req-${++requestCounter}`
            const lifecycleEvent = buildAgentToolLifecycleEvent(
                toolName, input, requestId, now(), session.queryOpts?.agents || {}, {toolUseId: toolUseID},
            )
            if (lifecycleEvent) {
                if (lifecycleEvent.type === 'subagent_spawning') {
                    session.pendingAgentSpawns = session.pendingAgentSpawns || []
                    session.pendingAgentSpawns.push(lifecycleEvent)
                }
                logger.info({sessionId: sessionId?.slice(0, 8), toolName: lifecycleEvent.agentType, task: lifecycleEvent.task || 'no task'}, `${toolName} tool`)
                broadcast(sessionId, lifecycleEvent)
                resolve({behavior: 'allow', updatedInput: input})
                return
            }
            if (session.permissionMode === 'bypassPermissions') {
                resolve({behavior: 'allow', updatedInput: input})
                return
            }
            const isChoice = toolName === 'AskUserQuestion'
            const turnIdentity = session.activeTurnIdentity ? {...session.activeTurnIdentity} : null
            const entry = {
                id: requestId, sessionId, type: isChoice ? 'choice' : 'permission', toolName, input,
                questions: isChoice ? (input?.questions || []) : undefined,
                source: turnIdentity?.source || 'desktop', userId: turnIdentity?.userId || null,
                turnId: session.activeTurnId || null, expiresAt: now() + timeoutMs,
                resolve, settled: false, timeout: null,
            }
            entry.timeout = setTimeout(() => settlePending(sessionId, requestId,
                {behavior: 'deny', message: '确认超时', interrupt: true}, 'timeout'), timeoutMs)
            session.pending.set(requestId, entry)
            if (signal) signal.addEventListener('abort', () => settlePending(sessionId, requestId,
                {behavior: 'deny', message: '已取消', interrupt: true}, 'abort'), {once: true})
            logger.info({sessionId: sessionId?.slice(0, 8), requestId, type: entry.type, toolName}, '确认请求')
            broadcastTurn(sessionId, isChoice
                ? {type: 'choice_request', requestId, toolName, questions: entry.questions, turnId: entry.turnId}
                : {type: 'permission_request', requestId, toolName, input, turnId: entry.turnId}, turnIdentity)
            for (const hook of getConfirmHooks() || []) {
                if (!session.mirrors?.[hook.platform] || !shouldRouteMirror(hook.platform, turnIdentity)) continue
                try {
                    hook.onConfirmRequest?.({sessionId, requestId, type: entry.type, toolName, input,
                        questions: entry.questions, userId: turnIdentity?.userId || null})
                } catch (error) { logger.debug({err: error}, '确认适配器推送失败') }
            }
        })
    }

    function decisionToResult(entry, decision, optionIndex, questionIndex, customText) {
        if (entry.type === 'choice') {
            const label = customText || labelForChoice(entry, questionIndex ?? 0, optionIndex ?? 0)
            return {behavior: 'deny', message: `用户选择了: ${label}`, interrupt: false}
        }
        if (decision === 'allow') return {behavior: 'allow', updatedInput: entry.input}
        return {behavior: 'deny', message: '用户拒绝了该操作', interrupt: false}
    }

    return {settlePending, makeCanUseTool, decisionToResult, labelForChoice,
        get requestCounter() { return requestCounter }}
}
