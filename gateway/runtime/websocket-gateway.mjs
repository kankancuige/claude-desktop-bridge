/**
 * WebSocket upgrade 边界。
 *
 * 这里只负责 HTTP upgrade 的路径、来源和 token 认证；连接建立后的
 * Session 消息生命周期由 Gateway Runtime 处理，避免认证逻辑与会话状态耦合。
 */
export function createWebSocketGateway({
    httpServer,
    wss,
    port,
    authenticate,
    extractToken,
    imSources = new Set(),
    logger = {debug() {}},
} = {}) {
    if (!httpServer || typeof httpServer.on !== 'function') throw new TypeError('httpServer is required')
    if (!wss || typeof wss.handleUpgrade !== 'function') throw new TypeError('wss is required')
    if (typeof authenticate !== 'function' || typeof extractToken !== 'function') throw new TypeError('authentication functions are required')

    const reject = (socket, statusCode, reason) => {
        const text = String(reason || 'Forbidden').replace(/[\r\n]/g, ' ').slice(0, 100)
        socket.write(`HTTP/1.1 ${statusCode} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
        socket.destroy()
    }

    const handler = (req, socket, head) => {
        if (typeof req.url !== 'string' || req.url.length > 4096) {
            reject(socket, 414, 'URI Too Long')
            return
        }
        let parsed
        try {
            parsed = new URL(req.url, `ws://127.0.0.1:${port}`)
        } catch (error) {
            logger.debug({err: error}, 'WebSocket URL 解析失败')
            reject(socket, 400, 'Bad Request')
            return
        }
        if (!/^\/ws\/(control\/?|[^/]+)$/.test(parsed.pathname)) {
            reject(socket, 404, 'Not Found')
            return
        }
        const auth = authenticate(extractToken(req))
        if (!auth) {
            reject(socket, 401, 'Unauthorized')
            return
        }
        const source = parsed.searchParams.get('source') || 'desktop'
        const userId = req.headers?.['x-bridge-user-id']
        if (auth.kind === 'adapter') {
            if (source !== auth.platform || req.headers?.['x-bridge-source'] !== auth.platform || typeof userId !== 'string'
                || !userId || userId.length > 512 || /[\0\r\n]/.test(userId)) {
                reject(socket, 403, 'Forbidden')
                return
            }
            if (parsed.pathname === '/ws/control' || parsed.pathname === '/ws/control/') {
                reject(socket, 403, 'Forbidden')
                return
            }
        } else if (imSources.has(source)) {
            reject(socket, 403, 'Forbidden')
            return
        }
        req.bridgeWsAuth = auth
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
    }

    httpServer.on('upgrade', handler)
    return {handler, reject, detach: () => httpServer.off?.('upgrade', handler)}
}
