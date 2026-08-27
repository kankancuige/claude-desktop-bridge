/**
 * Gateway HTTP 入口的协议层。
 *
 * 这里仅处理 CORS、认证、Adapter 访问边界和路由分发；业务状态通过回调
 * 注入，组合根不再承载 URL 分支或响应格式细节。
 */
export function createHttpRequestHandler({
    port,
    allowTokenEndpoint = false,
    bridgeToken,
    authenticateBridgeToken,
    getAdapterIdentity,
    adapterRouteAllowed,
    adapterOwnsSession,
    routes = [],
    readBody,
    logHttpRequest,
    log,
} = {}) {
    const routeHandlers = routes.filter(handler => typeof handler === 'function')

    return async function handleHttpRequest(req, res) {
        res.setHeader('X-Source', 'github.com/kankancuige/claude-desktop-bridge')
        const httpStart = Date.now()
        const end = res.end.bind(res)
        res.end = function (...args) {
            logHttpRequest?.(log, req, res.statusCode, httpStart)
            return end(...args)
        }

        const origin = req.headers.origin
        const safeOrigin = !origin || origin === 'null'
            || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
        if (safeOrigin) {
            res.setHeader('Access-Control-Allow-Origin', origin || 'null')
            res.setHeader('Vary', 'Origin')
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-bridge-token, x-bridge-source, x-bridge-user-id')
        if (req.method === 'OPTIONS') {
            res.writeHead(204)
            res.end()
            return
        }

        let url
        try {
            url = new URL(req.url, `http://127.0.0.1:${port}`)
        } catch {
            res.writeHead(400)
            res.end(JSON.stringify({error: 'invalid request URL'}))
            return
        }

        const isTokenEndpoint = req.method === 'GET' && url.pathname === '/api/bridge-token'
        let requestAuth = null
        if (isTokenEndpoint) {
            if (!allowTokenEndpoint) {
                res.writeHead(404)
                res.end(JSON.stringify({error: 'not found'}))
                return
            }
        } else {
            requestAuth = authenticateBridgeToken?.(req.headers['x-bridge-token'])
            if (!requestAuth) {
                res.writeHead(403)
                res.end(JSON.stringify({error: 'forbidden: missing or invalid bridge token'}))
                return
            }
        }

        const requestIdentity = getAdapterIdentity?.(req)
        if (requestAuth?.kind === 'adapter') {
            if (!requestIdentity || requestIdentity.source !== requestAuth.platform) {
                res.writeHead(403)
                res.end(JSON.stringify({error: 'adapter identity mismatch'}))
                return
            }
            if (!adapterRouteAllowed?.(req.method, url.pathname, requestAuth.platform)) {
                res.writeHead(403)
                res.end(JSON.stringify({error: 'adapter route not allowed'}))
                return
            }
        }
        if (requestIdentity) {
            if (url.pathname === '/api/sessions' || url.pathname.startsWith('/api/workflows')) {
                res.writeHead(403)
                res.end(JSON.stringify({error: 'adapter route not allowed'}))
                return
            }
            const sessionRoute = url.pathname.match(/^\/api\/sessions\/([^/]+)/)
            const historyMessagesRoute = req.method === 'GET' && /^\/api\/sessions\/[^/]+\/messages$/.test(url.pathname)
            if (sessionRoute && !['resolve', 'focused'].includes(sessionRoute[1])
                && !historyMessagesRoute
                && !adapterOwnsSession?.(requestIdentity.source, requestIdentity.userId, sessionRoute[1])) {
                res.writeHead(403)
                res.end(JSON.stringify({error: 'session ownership mismatch'}))
                return
            }
        }
        res.setHeader('Content-Type', 'application/json')

        if (url.pathname === '/api/bridge-token' && req.method === 'GET') {
            res.writeHead(200)
            res.end(JSON.stringify({token: bridgeToken}))
            return
        }

        const context = {req, res, url, readBody}
        for (const route of routeHandlers) {
            if (await route(context)) return
        }
        if (!res.headersSent) {
            res.writeHead(404)
            res.end(JSON.stringify({error: 'not found'}))
        }
    }
}
