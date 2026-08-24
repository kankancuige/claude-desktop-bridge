/** Session Catalog、镜像状态和事件日志的持久化端口。 */
export function createSessionStateStorageRuntime({
    bridgeHome,
    joinPath,
    encodeProjectName,
    normalizeWorkDir,
    mirrorStorePath,
    mirrorSessionIds,
    getPersistedMirrors,
    setPersistedMirror,
    setPersistedMirrors,
    removePersistedMirrors,
    readJSON,
    writeJSON,
    existsSync,
    statSync,
    getSessionRepository = () => null,
    isUserSessionSource,
    SessionEventJournal,
    sessionEventStorePath,
    logger = {warn() {}, error() {}},
} = {}) {
    if (!bridgeHome || typeof joinPath !== 'function' || typeof encodeProjectName !== 'function'
        || typeof normalizeWorkDir !== 'function' || typeof mirrorStorePath !== 'function'
        || typeof mirrorSessionIds !== 'function' || typeof getPersistedMirrors !== 'function'
        || typeof setPersistedMirror !== 'function' || typeof setPersistedMirrors !== 'function'
        || typeof removePersistedMirrors !== 'function' || typeof readJSON !== 'function'
        || typeof writeJSON !== 'function'
        || typeof existsSync !== 'function' || typeof statSync !== 'function'
        || typeof isUserSessionSource !== 'function' || typeof SessionEventJournal !== 'function'
        || typeof sessionEventStorePath !== 'function') {
        throw new TypeError('session state storage dependencies are required')
    }

    function sessionMirrorStorePath(workDir) {
        return mirrorStorePath(joinPath(bridgeHome, 'projects', encodeProjectName(workDir)))
    }

    function sessionMirrorIds(session, sessionId = null) {
        return mirrorSessionIds(sessionId, session?.lastSessionId, session?.taskState?.sdkSessionId,
            session?.taskState?.historySessionId, session?.queryOpts?.resume)
    }

    function sessionCatalogProjectKey(workDir) {
        return encodeProjectName(normalizeWorkDir(workDir))
    }

    function sessionCatalogIds(session, sessionId = null) {
        return sessionMirrorIds(session, sessionId)
    }

    function ensureSessionCatalogIdentity(workDir, gatewaySessionId, sdkSessionId, source = 'desktop') {
        const repository = getSessionRepository()
        if (!repository || !workDir || !sdkSessionId) return false
        try {
            const projectKey = sessionCatalogProjectKey(workDir)
            const projectDir = joinPath(bridgeHome, 'projects', projectKey)
            const transcriptPath = joinPath(projectDir, `${sdkSessionId}.jsonl`)
            const stat = existsSync(transcriptPath) ? statSync(transcriptPath) : null
            if (!stat?.isFile?.()) return false
            repository.upsert({
                projectKey,
                sessionId: sdkSessionId,
                sdkSessionId,
                workDir,
                source: isUserSessionSource(source) ? source : 'desktop',
                visibility: 'visible',
                transcriptPath,
                mtime: stat.mtimeMs || 0,
                size: stat.size || 0,
                title: sdkSessionId.slice(0, 8),
            })
            return true
        } catch (error) {
            logger.warn({err: error, workDir, sessionId: sdkSessionId?.slice?.(0, 8)}, 'Session PostgreSQL 身份索引保存失败')
            return false
        }
    }

    function readSessionCatalogSettings(session, sessionId = null) {
        const repository = getSessionRepository()
        if (!repository || !session?.workDir) return null
        const projectKey = sessionCatalogProjectKey(session.workDir)
        for (const id of sessionCatalogIds(session, sessionId)) {
            const row = repository.get({projectKey, sessionId: id})
            if (row) return row
        }
        return null
    }

    function persistSessionCatalogSettings(session, sessionId = null, patch = {}) {
        const repository = getSessionRepository()
        if (!repository || !session?.workDir) return false
        try {
            const ids = sessionCatalogIds(session, sessionId)
            const projectKey = sessionCatalogProjectKey(session.workDir)
            const existing = ids.some(id => repository.get({projectKey, sessionId: id}))
            if (!existing && ids.length > 0) {
                ensureSessionCatalogIdentity(session.workDir, sessionId || ids[0], session.lastSessionId || session.taskState?.sdkSessionId || session.queryOpts?.resume || sessionId || ids[0], session.visibleSource || 'desktop')
            }
            return repository.updateSettings({projectKey, sessionIds: ids, patch})
        } catch (error) {
            logger.warn({err: error, sessionId: sessionId?.slice?.(0, 8)}, 'Session PostgreSQL 设置索引保存失败')
            return false
        }
    }

    function restoreSessionMirrors(session, sessionId = null) {
        if (!session?.workDir) return false
        try {
            const path = sessionMirrorStorePath(session.workDir)
            const catalog = readSessionCatalogSettings(session, sessionId)
            session.mirrors = catalog?.mirrors || getPersistedMirrors(readJSON(path), sessionMirrorIds(session, sessionId))
            return true
        } catch (error) {
            logger.warn({err: error, sessionId: sessionId?.slice?.(0, 8)}, 'Session 镜像状态恢复失败')
            return false
        }
    }

    function persistSessionMirrors(session, sessionId = null, platform = null, enabled = null) {
        if (!session?.workDir) return false
        try {
            const path = sessionMirrorStorePath(session.workDir)
            const ids = sessionMirrorIds(session, sessionId)
            if (ids.length === 0) return false
            let next = readJSON(path)
            next = platform ? setPersistedMirror(next, ids, platform, enabled === true) : setPersistedMirrors(next, ids, session.mirrors)
            writeJSON(path, next)
            persistSessionCatalogSettings(session, sessionId, {mirrors: session.mirrors})
            return true
        } catch (error) {
            logger.warn({err: error, workDir: session.workDir, sessionId: sessionId?.slice?.(0, 8)}, 'Session 镜像状态保存失败')
            return false
        }
    }

    function removePersistedSessionMirrors(workDir, ids) {
        try {
            const path = sessionMirrorStorePath(workDir)
            const current = readJSON(path)
            if (!current) return true
            const next = removePersistedMirrors(current, ids)
            if (JSON.stringify(next) === JSON.stringify(current)) return true
            writeJSON(path, next)
            return true
        } catch (error) {
            logger.warn({err: error, workDir}, 'Session 镜像状态清理失败')
            return false
        }
    }

    function openSessionEventJournal(workDir, sessionId) {
        const projectDir = joinPath(bridgeHome, 'projects', encodeProjectName(workDir))
        return new SessionEventJournal({
            path: sessionEventStorePath(projectDir, sessionId),
            onCorrupt: result => logger.error({sessionId: sessionId?.slice?.(0, 8), code: result.code, line: result.line}, 'Session Event Journal 损坏，已隔离并回退兼容快照'),
        })
    }

    function appendSessionEvent(session, type, payload = {}, {critical = false} = {}) {
        if (!session?.eventJournal) {
            if (critical) throw Object.assign(new Error('Session Event Journal 未初始化'), {code: 'SESSION_EVENT_JOURNAL_UNAVAILABLE'})
            return null
        }
        try {
            return session.eventJournal.append(type, payload, {critical})
        } catch (error) {
            if (critical) throw error
            logger.warn({err: error, eventType: type}, 'Session Event Journal 写入失败')
            return null
        }
    }

    return {
        sessionMirrorStorePath, sessionMirrorIds, sessionCatalogProjectKey, sessionCatalogIds,
        ensureSessionCatalogIdentity, readSessionCatalogSettings, persistSessionCatalogSettings,
        restoreSessionMirrors, persistSessionMirrors, removePersistedSessionMirrors,
        openSessionEventJournal, appendSessionEvent,
    }
}
