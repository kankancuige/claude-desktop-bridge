/**
 * Session 输入上下文运行时。
 *
 * 这里仅负责把一次用户输入扩展为 SDK 可消费的上下文；项目 transcript、
 * 用户偏好和 PostgreSQL Memory 都通过显式依赖注入，避免读取组合根闭包。
 */
export function createSessionContextRuntime({
    bridgeHome,
    listProjectTranscriptCandidates,
    buildProjectContinuationContext,
    composeContinuationPrompt,
    userPreferences = null,
    memoryService = null,
    encodeProjectName,
    sessionRepository = null,
    contextPlanner = null,
    logger = {info() {}, warn() {}},
} = {}) {
    if (!bridgeHome || typeof bridgeHome !== 'string') throw new TypeError('bridgeHome is required')
    if (typeof listProjectTranscriptCandidates !== 'function') throw new TypeError('listProjectTranscriptCandidates is required')
    if (typeof buildProjectContinuationContext !== 'function') throw new TypeError('buildProjectContinuationContext is required')
    if (typeof composeContinuationPrompt !== 'function') throw new TypeError('composeContinuationPrompt is required')
    if (typeof encodeProjectName !== 'function') throw new TypeError('encodeProjectName is required')

    const resolveDependency = dependency => typeof dependency === 'function' ? dependency() : dependency

    async function resolveSdkInputContent(sessionId, session, prompt) {
        if (!session) return prompt
        let content = prompt
        if (!session.hasUserTurns && !session._continuationResolved) {
            session._continuationResolved = true
            try {
                const transcripts = listProjectTranscriptCandidates({
                    bridgeHome,
                    encodedDir: encodeProjectName(session.workDir),
                    workDir: session.workDir,
                    repository: resolveDependency(sessionRepository),
                })
                const context = buildProjectContinuationContext({
                    prompt,
                    hasUserTurns: session.hasUserTurns,
                    currentSessionId: session.lastSessionId || null,
                    transcripts,
                })
                if (context) {
                    logger.info({
                        sessionId: sessionId?.slice(0, 8),
                        sourceSessionId: context.sourceSessionId?.slice(0, 8),
                        contextLength: context.text.length,
                    }, '已按需注入项目会话接力上下文')
                    content = composeContinuationPrompt(prompt, context)
                }
            } catch (error) {
                logger.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '项目会话接力上下文读取失败，已按原消息继续')
            }
        }
        let enriched
        try {
            const preferences = resolveDependency(userPreferences)
            enriched = preferences?.inject
                ? preferences.inject(session.workDir, content, prompt)
                : content
        } catch (error) {
            enriched = content
            logger.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '用户偏好读取失败，已按原消息继续')
        }
        try {
            if (session.contextProfile === 'light') return enriched
            const memory = await resolveDependency(memoryService)?.retrieveAsync?.({
                workDir: session.workDir,
                encodedDir: encodeProjectName(session.workDir),
                text: prompt,
                scope: session.taskScope || 'project',
                agentType: session.agentName || '',
                taskId: session.taskCompletionTaskId || session.coordinatorTaskId || '',
            })
            if (memory?.text) {
                logger.info({sessionId: sessionId?.slice(0, 8), itemCount: memory.items?.length || 0, memoryReason: memory.reason}, '已按需注入项目 Memory')
                const planner = resolveDependency(contextPlanner)
                const contextPlan = planner?.planContext?.({
                    profile: session.contextProfile || 'full',
                    task: {goal: prompt, currentStep: session.taskState?.phase, status: session.taskState?.status},
                    projectSummary: session.projectContext?.summary || session.projectContext?.overview || '',
                    memoryCandidates: (memory.items || []).map(item => ({...item, body: item.body || (item.sourcePath ? '' : memory.text)})),
                    memoryText: memory.text,
                    references: (memory.items || []).map(item => item.sourcePath || item.sourceKey || item.id).filter(Boolean),
                    budget: {maxInputTokens: session.queryOpts?.bridgeContextSafetyCap ? Math.floor(Number(session.queryOpts.bridgeContextSafetyCap) * 0.25) : 8_000},
                    includeDetails: session.contextProfile === 'full',
                })
                const selectedText = contextPlan?.contextText || memory.text
                enriched = `${selectedText}\n\n${enriched}`
                session._lastContextPlan = contextPlan || null
                session.taskContextPlan = contextPlan ? {
                    profile: contextPlan.profile,
                    estimatedInputTokens: contextPlan.estimatedInputTokens,
                    maxInputTokens: contextPlan.maxInputTokens,
                    selectedLayers: Object.entries(contextPlan.layers || {}).filter(([, value]) => value?.selected).map(([layer]) => layer),
                    omitted: Array.isArray(contextPlan.omitted) ? contextPlan.omitted.slice(0, 20) : [],
                    references: Array.isArray(contextPlan.references) ? contextPlan.references.slice(0, 20) : [],
                } : null
            }
        } catch (error) {
            logger.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '项目 Memory 读取失败，已按原消息继续')
        }
        return enriched
    }

    return {resolveSdkInputContent}
}
