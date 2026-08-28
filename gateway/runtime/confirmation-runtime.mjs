import {buildAgentToolLifecycleEvent} from '../agents/agent-tool-lifecycle.mjs'
import {randomUUID} from 'node:crypto'
import {settleSessionToolConfirmation} from '../sessions/session-tool-activity.mjs'

export function normalizeChoiceQuestions(rawQuestions) {
    const seen = new Map()
    return (Array.isArray(rawQuestions) ? rawQuestions : []).slice(0, 4).map((rawQuestion, index) => {
        const question = rawQuestion && typeof rawQuestion === 'object' ? rawQuestion : {}
        const base = String(question.question || question.header || `问题 ${index + 1}`).trim() || `问题 ${index + 1}`
        const count = (seen.get(base) || 0) + 1
        seen.set(base, count)
        return {
            ...question,
            question: count === 1 ? base : `${base} (${count})`,
            answerKey: `q-${index}`,
        }
    })
}

/** 跨桌面端和 IM 适配器的确认请求生命周期。 */
export function createConfirmationRuntime({
    sessions,
    getConfirmHooks = () => [],
    broadcastTurn,
    broadcast,
    broadcastDesktop = broadcast,
    shouldRouteMirror,
    logger = {info() {}, debug() {}},
    now = () => Date.now(),
    timeoutMs = 5 * 60 * 1000,
    requestNamespace = randomUUID(),
    onSettled = () => {},
} = {}) {
    if (!sessions || typeof broadcastTurn !== 'function' || typeof broadcast !== 'function'
        || typeof shouldRouteMirror !== 'function') {
        throw new TypeError('confirmation runtime dependencies are required')
    }
    let requestCounter = 0
    const safeRequestNamespace = String(requestNamespace || randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || randomUUID()

    function confirmationRequestEvent(entry) {
        const optional = {
            ...(entry.toolUseId ? {toolUseId: entry.toolUseId} : {}),
            ...(Number.isFinite(entry.expiresAt) ? {expiresAt: entry.expiresAt} : {}),
        }
        return entry.type === 'choice'
            ? {type: 'choice_request', requestId: entry.id, toolName: entry.toolName, questions: entry.questions,
                ...(Object.keys(entry.input?.answers || {}).length ? {answers: entry.input.answers} : {}), ...optional, turnId: entry.turnId}
            : {type: 'permission_request', requestId: entry.id, toolName: entry.toolName, input: entry.input, ...optional, turnId: entry.turnId}
    }

    function settlePending(sessionId, requestId, result, wonBy) {
        const session = sessions.get(sessionId)
        if (!session) return false
        const entry = session.pending?.get(requestId)
        if (!entry || entry.settled) return false
        entry.settled = true
        if (entry.timeout) clearTimeout(entry.timeout)
        session.pending.delete(requestId)
        settleSessionToolConfirmation(session, entry, now())
        const resolvers = Array.isArray(entry.resolvers) && entry.resolvers.length ? entry.resolvers : [entry.resolve]
        for (const resolve of resolvers) {
            try { resolve?.(result) } catch (error) { logger.debug({err: error}, '确认结果释放失败') }
        }
        logger.info({
            sessionId: sessionId?.slice(0, 8), requestId, type: entry.type,
            toolName: entry.toolName, decision: result?.behavior || 'unknown',
            wonBy, pendingCount: session.pending.size,
        }, '确认请求已结算')
        broadcastTurn(sessionId, {
            type: 'confirmation_resolved', requestId,
            confirmationType: entry.type, toolName: entry.toolName,
            decision: result?.behavior || 'unknown', wonBy,
            pendingCount: session.pending.size,
            turnId: entry.turnId || null,
        }, entry.userId ? {source: entry.source, userId: entry.userId} : null)
        for (const hook of getConfirmHooks() || []) {
            try { hook.onConfirmResolved?.(sessionId, requestId, {
                wonBy, decision: result?.behavior || 'unknown', confirmationType: entry.type,
                toolName: entry.toolName, turnId: entry.turnId || null,
            }) }
            catch (error) { logger.debug({err: error}, '确认适配器收口失败') }
        }
        try { onSettled(sessionId, session, entry, result, wonBy) }
        catch (error) { logger.debug({err: error}, '确认结算后的运行态刷新失败') }
        const nextPending = [...session.pending.values()].find(item => !item?.settled)
        if (nextPending) broadcastDesktop(sessionId, confirmationRequestEvent(nextPending))
        return true
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
            if (signal?.aborted) {
                resolve({behavior: 'deny', message: '已取消', interrupt: true})
                return
            }
            const existing = toolUseID
                ? [...session.pending.values()].find(item => !item?.settled && item.toolUseId === toolUseID)
                : null
            if (existing) {
                existing.resolvers = Array.isArray(existing.resolvers) ? existing.resolvers : [existing.resolve]
                existing.resolvers.push(resolve)
                return
            }
            const requestId = `req-${safeRequestNamespace}-${++requestCounter}`
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
            const questions = isChoice ? normalizeChoiceQuestions(input?.questions) : undefined
            const entry = {
                id: requestId, sessionId, type: isChoice ? 'choice' : 'permission', toolName, input,
                questions, toolUseId: toolUseID || null,
                source: turnIdentity?.source || 'desktop', userId: turnIdentity?.userId || null,
                turnId: session.activeTurnId || null, expiresAt: now() + timeoutMs,
                resolve, resolvers: [resolve], settled: false, timeout: null,
            }
            entry.timeout = setTimeout(() => settlePending(sessionId, requestId,
                {behavior: 'deny', message: '确认超时', interrupt: true}, 'timeout'), timeoutMs)
            session.pending.set(requestId, entry)
            if (signal) signal.addEventListener('abort', () => settlePending(sessionId, requestId,
                {behavior: 'deny', message: '已取消', interrupt: true}, 'abort'), {once: true})
            logger.info({sessionId: sessionId?.slice(0, 8), requestId, type: entry.type, toolName}, '确认请求')
            broadcastTurn(sessionId, confirmationRequestEvent(entry), turnIdentity)
            for (const hook of getConfirmHooks() || []) {
                if (!session.mirrors?.[hook.platform] || !shouldRouteMirror(hook.platform, turnIdentity)) continue
                try {
                    hook.onConfirmRequest?.({sessionId, requestId, type: entry.type, toolName, input,
                        questions: entry.questions, toolUseId: entry.toolUseId, userId: turnIdentity?.userId || null})
                } catch (error) { logger.debug({err: error}, '确认适配器推送失败') }
            }
        })
    }

    function decisionToResult(entry, decision, optionIndex, questionIndex, customText, providedAnswers) {
        if (entry.type === 'choice') {
            const questions = Array.isArray(entry.questions) ? entry.questions : []
            const answerKey = (question, index) => String(question?.answerKey || question?.question || `q-${index}`)
            const inputAnswers = entry.input?.answers && typeof entry.input.answers === 'object' ? entry.input.answers : {}
            const answerFor = (answers, question, index) => String(
                answers?.[answerKey(question, index)] ?? answers?.[question?.question] ?? '',
            ).trim()
            const updatedQuestions = questions.map(({answerKey: _answerKey, ...question}) => question)
            const finalize = answersByKey => ({
                behavior: 'allow',
                updatedInput: {
                    ...entry.input,
                    questions: updatedQuestions,
                    answers: Object.fromEntries(questions.map((question, index) => [
                        question.question,
                        answerFor(answersByKey, question, index),
                    ])),
                },
            })
            if (providedAnswers && typeof providedAnswers === 'object' && !Array.isArray(providedAnswers)) {
                const answers = {...inputAnswers, ...providedAnswers}
                for (let index = 0; index < questions.length; index += 1) {
                    if (!answerFor(answers, questions[index], index)) {
                        return {incomplete: true, message: '请完成所有问题后再提交'}
                    }
                }
                return finalize(answers)
            }
            const existingAnswers = {...inputAnswers}
            const firstUnanswered = questions.findIndex((question, index) => !answerFor(existingAnswers, question, index))
            const requestedIndex = Number(questionIndex)
            const index = Number.isInteger(requestedIndex) && requestedIndex >= 0
                ? requestedIndex : (firstUnanswered >= 0 ? firstUnanswered : 0)
            const question = entry.questions?.[index]
            const label = String(customText || labelForChoice(entry, index, optionIndex ?? 0)).trim()
            if (!question || !label || (!customText && !question.options?.[optionIndex])) {
                return {incomplete: true, message: '用户选择无效，请重新选择'}
            }
            const answers = {...existingAnswers, [answerKey(question, index)]: label}
            if (questions.some((item, itemIndex) => !answerFor(answers, item, itemIndex))) {
                return {incomplete: true, answers, message: `已记录“${label}”，请继续回答剩余问题`}
            }
            return finalize(answers)
        }
        if (decision === 'allow') return {behavior: 'allow', updatedInput: entry.input}
        return {behavior: 'deny', message: '用户拒绝了该操作', interrupt: false}
    }

    return {settlePending, makeCanUseTool, decisionToResult, labelForChoice,
        get requestCounter() { return requestCounter }}
}
