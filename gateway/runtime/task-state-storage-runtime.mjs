/** 任务状态持久化端口：文件兼容快照与 PostgreSQL 结构化投影。 */
export function createTaskStateStorageRuntime({
    bridgeHome,
    encodeProjectName,
    joinPath,
    taskStateFileId,
    readJSON,
    writeJSON,
    recoverTaskState,
    sessionCatalogProjectKey,
    getWorkbenchRepository = () => null,
    looksLikeIncompleteTransportFailure,
    logger = {warn() {}},
} = {}) {
    if (!bridgeHome || typeof encodeProjectName !== 'function' || typeof joinPath !== 'function'
        || typeof taskStateFileId !== 'function' || typeof readJSON !== 'function'
        || typeof writeJSON !== 'function' || typeof recoverTaskState !== 'function'
        || typeof sessionCatalogProjectKey !== 'function'
        || typeof looksLikeIncompleteTransportFailure !== 'function') {
        throw new TypeError('task state storage dependencies are required')
    }

    function taskStateStorePath(workDir, sessionId) {
        const safeId = taskStateFileId(sessionId, null)
        return safeId ? joinPath(bridgeHome, 'projects', encodeProjectName(workDir), 'bridge-task-state', `${safeId}.json`) : null
    }

    function saveTaskState(session, sessionId) {
        try {
            if (!session?.taskState || !session.workDir || !sessionId) return true
            writeJSON(taskStateStorePath(session.workDir, sessionId), session.taskState)
            const sdkSessionId = session.taskState.sdkSessionId || session.lastSessionId
            if (sdkSessionId && sdkSessionId !== sessionId) writeJSON(taskStateStorePath(session.workDir, sdkSessionId), session.taskState)
            return true
        } catch (error) {
            logger.warn({err: error, sessionId: sessionId?.slice?.(0, 8)}, 'task-state 保存失败')
            return false
        }
    }

    function loadTaskState(workDir, sessionId) {
        const path = taskStateStorePath(workDir, sessionId)
        const fileState = path ? readJSON(path) : null
        const repository = getWorkbenchRepository()
        if (repository && workDir && sessionId) {
            try {
                const projected = repository.getTask({projectKey: sessionCatalogProjectKey(workDir), taskKey: sessionId})
                if (projected?.state && typeof projected.state === 'object' && projected.state.status) {
                    return recoverTaskState({
                        ...(fileState && typeof fileState === 'object' ? fileState : {}),
                        ...projected.state,
                        detail: fileState?.detail || '',
                        finalReplyText: fileState?.finalReplyText || '',
                        finalReplyAvailable: fileState?.finalReplyAvailable === true || Boolean(fileState?.finalReplyText),
                        review: {
                            ...(fileState?.review && typeof fileState.review === 'object' ? fileState.review : {}),
                            ...(projected.state.review && typeof projected.state.review === 'object' ? projected.state.review : {}),
                        },
                    })
                }
            } catch (error) {
                logger.warn({err: error, workDir, sessionId: sessionId?.slice?.(0, 8)}, 'PostgreSQL task-state 投影读取失败，回退文件')
            }
        }
        return fileState ? recoverTaskState(fileState) : null
    }

    function persistTaskStateProjection(session, sessionId, state, eventType = 'task/state-changed') {
        const repository = getWorkbenchRepository()
        if (!repository || !session?.workDir || !state) return false
        try {
            const projectKey = sessionCatalogProjectKey(session.workDir)
            const taskKey = state.taskId || state.sdkSessionId || state.historySessionId || sessionId
            const revision = Math.max(1, Number(session._taskStateRevision || 0), Number(state.updatedAt || 0))
            session._taskStateRevision = revision
            session._taskEventRevision = Math.max(Number(session._taskEventRevision || 0), Date.now())
            const eventRevision = Math.max(1, session._taskEventRevision + 1)
            session._taskEventRevision = eventRevision
            return repository.upsertTask({
                projectKey,
                taskKey,
                sessionId,
                taskId: state.taskId,
                sdkSessionId: state.sdkSessionId || state.historySessionId,
                status: state.status,
                outcome: state.outcome,
                continuationReason: state.continuationReason,
                phase: state.status,
                reviewState: state.review?.tier || null,
                modelTier: session.modelTier || session.modelMode || null,
                errorCode: state.continuationReason === 'execution_error' ? 'EXECUTION_ERROR' : null,
                sequence: state.sequence,
                revision,
                eventRevision,
                startedAt: state.startedAt,
                completedAt: state.completedAt,
                updatedAt: state.updatedAt,
                notifications: state.notifications,
                state,
                eventType,
            })
        } catch (error) {
            logger.warn({err: error, sessionId: sessionId?.slice?.(0, 8)}, 'PostgreSQL task-state 投影保存失败，保留文件事实源')
            return false
        }
    }

    function repairPersistedTaskState(state) {
        if (!state || state.status !== 'succeeded') return state
        const text = [state.detail, state.finalReplyText].filter(Boolean).join('\n')
        if (!looksLikeIncompleteTransportFailure(text)) return state
        return {
            ...state,
            status: 'failed',
            outcome: 'failed',
            continuationReason: 'execution_error',
            resumable: true,
            detail: state.detail || state.finalReplyText,
        }
    }

    return {taskStateStorePath, saveTaskState, loadTaskState, persistTaskStateProjection, repairPersistedTaskState}
}
