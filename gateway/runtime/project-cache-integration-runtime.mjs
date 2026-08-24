/** 项目缓存注入和回合结束增量更新。 */
export function createProjectCacheIntegrationRuntime({
    loadProjectCache,
    buildCacheInjectionText,
    isExplorationAttempt,
    currentFileScan,
    diffSnapshotVsCurrent,
    buildProjectCache,
    saveProjectCache,
    updateProjectCache,
    markInternalInput,
    logger = {info() {}},
} = {}) {
    if (typeof loadProjectCache !== 'function' || typeof buildCacheInjectionText !== 'function'
        || typeof isExplorationAttempt !== 'function' || typeof currentFileScan !== 'function'
        || typeof diffSnapshotVsCurrent !== 'function' || typeof buildProjectCache !== 'function'
        || typeof saveProjectCache !== 'function' || typeof updateProjectCache !== 'function'
        || typeof markInternalInput !== 'function') throw new TypeError('project cache integration dependencies are required')

    function maybeInjectProjectCache(sessionId, session, wsMessage) {
        if (session._cacheInjected || !session.pushStream) return
        if (!isExplorationAttempt(wsMessage.tool_name, wsMessage.input)) return
        const cache = loadProjectCache(session.workDir)
        const text = cache ? buildCacheInjectionText(cache) : ''
        if (!text) return
        session._cacheInjected = true
        markInternalInput(session)
        session.pushStream.push({type: 'user', session_id: sessionId,
            message: {role: 'user', content: [{type: 'text', text}]}, parent_tool_use_id: null})
        logger.info({sessionId: sessionId?.slice(0, 8), toolName: wsMessage.tool_name}, 'project-cache 已注入')
    }

    async function maybeUpdateProjectCache(sessionId, session) {
        if (!session.pendingTurn?.preSnapshot) return
        const cache = loadProjectCache(session.workDir)
        const scan = currentFileScan(session.workDir, session.pendingTurn.preSnapshot)
        if (scan.missing) return
        const diffMap = diffSnapshotVsCurrent(session.pendingTurn.preSnapshot, scan.files, session.workDir)
        const changedCount = [...diffMap.values()].filter(item => item.status !== 'unchanged').length
        if (changedCount === 0 && cache) return
        if (!cache) {
            const next = await buildProjectCache(session.workDir)
            if (next) saveProjectCache(session.workDir, next)
            return
        }
        const result = await updateProjectCache(session.workDir, cache, diffMap)
        if (result.updated > 0) {
            saveProjectCache(session.workDir, cache)
            logger.info({sessionId: sessionId?.slice(0, 8), updated: result.updated, skipped: result.skipped}, 'project-cache 已更新')
        }
    }
    return {maybeInjectProjectCache, maybeUpdateProjectCache}
}
