/** Session SDK 资源关闭和清理边界。 */
export function createSessionResourceRuntime({
    logger = {warn() {}, debug() {}},
    withTimeout = (promise) => promise,
    sessionCoordinator = null,
} = {}) {
    async function closeSessionRuntime(session, {sessionId = '', reason = 'unknown', timeoutMs = 5000} = {}) {
        if (!session) return {pushStreamClosed: true, queryClosed: true}
        if (session.cleanupRegistry?.abort) {
            const snapshot = await session.cleanupRegistry.abort(reason)
            sessionCoordinatorClearTimeout(session)
            const queryEntry = snapshot.entries.find(entry => entry.kind === 'query')
            const streamEntry = snapshot.entries.find(entry => entry.kind === 'stream')
            session.diagnostics?.record?.({
                phase: 'cleanup',
                cleanupOutcome: [queryEntry, streamEntry].some(entry => entry?.status === 'failed') ? 'failed' : 'cleaned',
                errorCode: reason,
            })
            session.newCleanupRegistry?.()
            return {
                pushStreamClosed: !streamEntry || !['failed', 'running', 'registered'].includes(streamEntry.status),
                queryClosed: !queryEntry || !['failed', 'running', 'registered'].includes(queryEntry.status),
                cleanup: snapshot,
            }
        }
        let pushStreamClosed = true
        let queryClosed = true
        try { session.pushStream?.close() }
        catch (error) { pushStreamClosed = false; logger.warn({err: error, sessionId: sessionId?.slice(0, 8), reason}, '关闭 Session 输入流失败') }
        try {
            const closing = session.query?.return?.()
            if (closing && typeof closing.then === 'function') await withTimeout(Promise.resolve(closing), timeoutMs)
        } catch (error) { queryClosed = false; logger.warn({err: error, sessionId: sessionId?.slice(0, 8), reason}, '关闭 Session query 失败') }
        return {pushStreamClosed, queryClosed}
    }

    // Cleanup Registry 由 Session Coordinator 自己收口，这里只提供可替换的超时清理钩子。
    function sessionCoordinatorClearTimeout(session) { sessionCoordinator?.clearTimeout?.(session) }

    return {closeSessionRuntime}
}
