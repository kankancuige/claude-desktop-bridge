/** 活跃 Query 控制请求和动态资源缓存。 */
export function createDynamicCacheRuntime({
    cachePath,
    readJSON = () => null,
    writeJSON = () => {},
    writeFileSync = null,
    logger = {debug() {}, warn() {}},
    sessions = new Map(),
    getFocusedSessionId = () => null,
} = {}) {
    if (!cachePath) throw new TypeError('cachePath is required')
    const dynamicCache = {models: null, commands: null, agentNames: null, updatedAt: 0}
    try {
        const stored = readJSON(cachePath)
        if (stored && typeof stored === 'object') Object.assign(dynamicCache, stored)
    } catch (error) { logger.debug({err: error}, '动态缓存恢复失败') }
    let persistTimer = null

    function persistDynamicCache() {
        if (persistTimer) clearTimeout(persistTimer)
        persistTimer = setTimeout(() => {
            persistTimer = null
            try {
                if (typeof writeFileSync === 'function') writeFileSync(cachePath, JSON.stringify(dynamicCache), 'utf8')
                else writeJSON(cachePath, dynamicCache)
            } catch (error) { logger.debug({err: error}, '动态缓存落盘失败') }
        }, 500)
    }

    function getLiveQuery() {
        const focused = getFocusedSessionId()
        if (focused) {
            const session = sessions.get(focused)
            if (session?.query) return session.query
        }
        for (const session of sessions.values()) if (session.query) return session.query
        return null
    }

    function withTimeout(promise, ms) {
        let timer
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms) })
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
    }

    return {dynamicCache, persistDynamicCache, getLiveQuery, withTimeout,
        get persistTimer() { return persistTimer }}
}
