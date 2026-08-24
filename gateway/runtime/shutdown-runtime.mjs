/**
 * Gateway 关闭生命周期。
 *
 * 关闭顺序由组合根注入资源，服务本身不依赖具体 Provider、数据库或
 * WebSocket 实现；单个资源失败只记录并继续，整体有明确超时上限。
 */
export function createShutdownRuntime({
    logger = {info() {}, warn() {}, debug() {}, fatal() {}},
    getShuttingDown = () => false,
    setShuttingDown = () => {},
    adapters = [],
    stopAdapter = () => {},
    cronJobs = new Map(),
    destroyScheduledJob = () => {},
    scheduledRuns = new Map(),
    finishScheduledRun = () => {},
    wsPingTimer = null,
    wss = {clients: new Set()},
    sessions = new Map(),
    finishImProgressReporters = () => {},
    settlePending = () => {},
    appendSessionEvent = () => {},
    taskCommands = {dispose() {}},
    providerRegistry = {disposeAll: async () => {}},
    stopProxies = [],
    getStateDb = () => null,
    getStorageGateway = () => null,
    httpServer = null,
    exit = code => process.exit(code),
    timeoutMs = 2_200,
} = {}) {
    let running = false
    const closeResource = (label, action) => {
        try {
            const value = action?.()
            return value && typeof value.then === 'function' ? value.catch(error => logger.warn({err: error}, `${label} 关闭不完整`)) : null
        } catch (error) {
            logger.debug({err: error}, `${label} 关闭失败`)
            return null
        }
    }

    async function shutdown(reason, exitCode = 0) {
        if (running || getShuttingDown()) return false
        running = true
        setShuttingDown(true)
        logger.info({reason}, 'Gateway 开始关闭')
        const closers = []
        for (const platform of adapters) closeResource(`适配器 ${platform}`, () => stopAdapter(platform))
        for (const taskId of [...cronJobs.keys()]) closeResource('定时任务', () => destroyScheduledJob(taskId))
        for (const taskId of [...scheduledRuns.keys()]) closeResource('定时任务运行', () => finishScheduledRun(taskId))
        if (wsPingTimer) clearInterval(wsPingTimer)
        for (const ws of wss.clients || []) closeResource('WebSocket', () => ws.close(1001, 'gateway shutting down'))
        for (const [sessionId, session] of sessions) {
            finishImProgressReporters(sessionId)
            for (const requestId of [...(session.pending?.keys?.() || [])]) {
                closeResource('Session pending request', () => settlePending(sessionId, requestId,
                    {behavior: 'deny', message: 'Gateway 正在关闭', interrupt: true}, 'shutdown'))
            }
            closeResource('Session input stream', () => session.pushStream?.close())
            try {
                const closing = session.query?.return?.()
                if (closing && typeof closing.then === 'function') closers.push(closing)
            } catch (error) {
                logger.debug({err: error, sessionId: sessionId?.slice?.(0, 8)}, '关闭 Session query 失败')
            }
            appendSessionEvent(session, 'runtime/shutdown', {reason: String(reason || 'shutdown').slice(0, 120)})
            closeResource('Session Event Journal', () => session.eventJournal?.close())
        }
        closeResource('Task Command', () => taskCommands.dispose())
        closers.push(Promise.resolve(providerRegistry.disposeAll()).catch(error => logger.warn({err: error}, 'Agent Provider Registry 关闭不完整')))
        for (const [label, proxy] of stopProxies) {
            const closing = closeResource(label, proxy)
            if (closing) closers.push(closing)
        }
        const stateClosing = closeResource('PostgreSQL 状态适配器', () => getStateDb()?.close?.())
        if (stateClosing) closers.push(stateClosing)
        const storageClosing = closeResource('PostgreSQL StorageGateway', () => getStorageGateway()?.close?.())
        if (storageClosing) closers.push(storageClosing)
        const serverClosed = new Promise(resolve => {
            if (!httpServer || !httpServer.listening) { resolve(); return }
            httpServer.close(() => resolve())
        })
        await Promise.race([
            Promise.allSettled([...closers, serverClosed]),
            new Promise(resolve => setTimeout(resolve, timeoutMs)),
        ])
        logger.info({reason}, 'Gateway 已关闭')
        exit(exitCode)
        return true
    }

    function request(reason, exitCode = 0) {
        return shutdown(reason, exitCode).catch(error => {
            logger.fatal({err: error, reason}, 'Gateway 关闭失败')
            exit(exitCode || 1)
        })
    }

    return {shutdown, request, get running() { return running }}
}
