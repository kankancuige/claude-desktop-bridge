export function scheduleSessionBackgroundInitialization({
    sessionId,
    session,
    getSession,
    loadSnapshot,
    buildSnapshot,
    saveSnapshot,
    buildGitContext,
    loadCheckpoints,
    log = {},
    defer = callback => setImmediate(callback),
} = {}) {
    if (!sessionId || !session || typeof getSession !== 'function') return false

    defer(() => {
        // 只允许仍绑定到同一 Gateway Session 的实例接收迟到结果。
        if (getSession(sessionId) !== session) return
        const startedAt = Date.now()
        try {
            const persisted = loadSnapshot?.(session.workDir, sessionId)
            if (getSession(sessionId) !== session) return
            session.snapshot = persisted || buildSnapshot?.(session.workDir) || null
            session.snapshotReady = true
            if (!persisted && session.snapshot) saveSnapshot?.(session, sessionId)
        } catch (error) {
            session.snapshotReady = true
            log.warn?.({err: error, sessionId: sessionId.slice(0, 8)}, '后台初始化 Session snapshot 失败')
        }

        try {
            const gitContext = buildGitContext?.(session.workDir)
            if (getSession(sessionId) !== session) return
            if (gitContext) session._gitContext = gitContext
        } catch (error) {
            log.debug?.({err: error, sessionId: sessionId.slice(0, 8)}, '后台构建 Git 上下文失败')
        }

        try {
            const checkpoints = loadCheckpoints?.(session.workDir, sessionId)
            if (getSession(sessionId) !== session) return
            session.checkpoints = Array.isArray(checkpoints) ? checkpoints : []
            session.checkpointSeq = session.checkpoints.reduce(
                (max, checkpoint) => Math.max(max, Number.parseInt(String(checkpoint.id).replace('cp-', ''), 10) || 0),
                0,
            )
            session.checkpointsLoaded = true
        } catch (error) {
            session.checkpointsLoaded = true
            log.warn?.({err: error, sessionId: sessionId.slice(0, 8)}, '后台加载 Session checkpoints 失败')
        }

        log.debug?.({sessionId: sessionId.slice(0, 8), durationMs: Date.now() - startedAt}, 'Session 后台初始化完成')
    })
    return true
}
