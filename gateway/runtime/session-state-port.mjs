/**
 * Session 状态端口。
 *
 * 只在 Session Runtime 内持有真实 Map；其他运行时通过这个稳定端口读取和
 * 修改会话，避免组合根把可变集合和 focused 状态复制成多个事实源。
 */
export function createSessionStatePort({sessions = new Map(), getFocusedSessionId, setFocusedSessionId} = {}) {
    if (!(sessions instanceof Map)) throw new TypeError('sessions must be a Map')
    if (typeof getFocusedSessionId !== 'function' || typeof setFocusedSessionId !== 'function') {
        throw new TypeError('focused session accessors are required')
    }

    let disposed = false
    const ensureActive = () => {
        if (disposed) throw Object.assign(new Error('Session State Port 已释放'), {code: 'SESSION_STATE_PORT_DISPOSED'})
    }

    const port = {
        get(sessionId) { return sessions.get(sessionId) || null },
        has(sessionId) { return sessions.has(sessionId) },
        set(sessionId, session) {
            ensureActive()
            if (!sessionId || !session || typeof session !== 'object') throw new TypeError('session id and session object are required')
            sessions.set(sessionId, session)
            return port
        },
        delete(sessionId) {
            ensureActive()
            const removed = sessions.delete(sessionId)
            if (getFocusedSessionId() === sessionId) setFocusedSessionId(null)
            return removed
        },
        entries() { return sessions.entries() },
        values() { return sessions.values() },
        keys() { return sessions.keys() },
        forEach(callback, thisArg) { return sessions.forEach(callback, thisArg) },
        get size() { return sessions.size },
        [Symbol.iterator]() { return sessions[Symbol.iterator]() },
        getFocusedSessionId() { return getFocusedSessionId() },
        setFocusedSessionId(sessionId) {
            ensureActive()
            if (sessionId !== null && typeof sessionId !== 'string') throw new TypeError('focused session id must be a string or null')
            if (sessionId !== null && !sessions.has(sessionId)) return false
            setFocusedSessionId(sessionId)
            return true
        },
        dispose() {
            if (disposed) return false
            disposed = true
            sessions.clear()
            setFocusedSessionId(null)
            return true
        },
        get disposed() { return disposed },
    }
    return port
}
