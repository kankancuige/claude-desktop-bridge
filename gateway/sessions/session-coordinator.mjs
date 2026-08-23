/**
 * 管理单个 Session 的 Query 重建竞争关系；不创建 SDK Query，避免把 Provider 与任务终态逻辑耦合回会话状态机。
 */
export function createSessionCoordinator() {
    return {
        snapshot(session) {
            return {
                rebuilding: Boolean(session?._rebuildPromise),
                rebuildId: session?._rebuildId || null,
                pendingMessages: Array.isArray(session?._pendingMessages) ? session._pendingMessages.length : 0,
                cancelled: Boolean(session?._coordinatorCancelled),
                cancelReason: session?._coordinatorCancelReason || null,
                timeoutActive: Boolean(session?._coordinatorTimeoutQuery),
                timeoutReason: session?._coordinatorTimeoutReason || null,
                contextPolicy: session?._lastContextReusePolicy || null,
            }
        },

        setContextPolicy(session, policy) {
            if (!session || typeof session !== 'object') return false
            session._lastContextReusePolicy = policy || null
            return true
        },

        beginTurn(session) {
            if (!session || typeof session !== 'object') return false
            session._coordinatorCancelled = false
            session._coordinatorCancelReason = null
            return true
        },

        beginTimeout(session, query, reason = 'timeout') {
            if (!session || typeof session !== 'object' || !query) return false
            session._coordinatorTimeoutQuery = query
            session._coordinatorTimeoutReason = String(reason || 'timeout').slice(0, 120)
            return true
        },

        clearTimeout(session, query = null) {
            if (!session || typeof session !== 'object') return false
            if (query && session._coordinatorTimeoutQuery && session._coordinatorTimeoutQuery !== query) return false
            session._coordinatorTimeoutQuery = null
            session._coordinatorTimeoutReason = null
            return true
        },

        isTimeoutCurrent(session, query) {
            return Boolean(session && query && session._coordinatorTimeoutQuery === query
                && !session._coordinatorCancelled)
        },

        cancel(session, reason = 'cancelled') {
            if (!session || typeof session !== 'object') return false
            session._coordinatorCancelled = true
            session._coordinatorCancelReason = String(reason || 'cancelled').slice(0, 120)
            this.clearTimeout(session)
            this.invalidate(session)
            return true
        },

        beginRebuild(session, firstMessage) {
            if (!session || typeof session !== 'object') throw new TypeError('Session Coordinator 需要 session 对象')
            if (session._rebuildPromise) return {started: false, token: session._rebuildId}
            const token = Symbol('session-rebuild')
            session._rebuildId = token
            this.beginTurn(session)
            session._pendingMessages = [firstMessage]
            // 调用方紧接着赋予实际 Promise；占位值先阻止同步到达的补充输入竞争创建第二个 Query。
            session._rebuildPromise = Promise.resolve()
            return {started: true, token}
        },

        attachPromise(session, token, promise) {
            if (!this.isCurrent(session, token)) return false
            session._rebuildPromise = promise
            return true
        },

        enqueue(session, message) {
            if (!session?._rebuildPromise) return false
            if (!Array.isArray(session._pendingMessages)) session._pendingMessages = []
            session._pendingMessages.push(message)
            return true
        },

        isCurrent(session, token) {
            return Boolean(session && token && session._rebuildId === token)
        },

        consumePendingMessages(session, token) {
            if (!this.isCurrent(session, token)) return []
            const pending = Array.isArray(session._pendingMessages) ? session._pendingMessages : []
            session._pendingMessages = null
            return pending
        },

        complete(session, token) {
            if (!this.isCurrent(session, token)) return false
            session._rebuildPromise = null
            session._rebuildId = null
            return true
        },

        fail(session, token) {
            if (!this.isCurrent(session, token)) return false
            session._rebuildPromise = null
            session._rebuildId = null
            session._pendingMessages = null
            return true
        },

        invalidate(session) {
            if (!session || typeof session !== 'object') return
            session._rebuildId = null
            session._rebuildPromise = null
            session._pendingMessages = null
            this.clearTimeout(session)
        },
    }
}
