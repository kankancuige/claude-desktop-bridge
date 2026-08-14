/**
 * Gateway 内部客户端：所有 Gateway 子模块调用本地 HTTP/WS 时都显式携带短期运行 token。
 */

function addIdentityHeaders(headers, identity) {
    if (identity?.source) headers.set('x-bridge-source', identity.source)
    if (identity?.userId) headers.set('x-bridge-user-id', identity.userId)
}

// 适配器与 Gateway 同进程运行时必须共用实际监听端口。
function resolveGatewayPort() {
    const configuredPort = Number.parseInt(process.env.PORT || '3456', 10)
    return Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65535 ? configuredPort : 3456
}

export function gatewayHttpBase() {
    return `http://127.0.0.1:${resolveGatewayPort()}`
}

export function gatewayWsUrl(path) {
    const suffix = String(path || '')
    return `ws://127.0.0.1:${resolveGatewayPort()}${suffix.startsWith('/') ? suffix : `/${suffix}`}`
}

export function gatewayFetch(url, token, init = {}, identity = null) {
    const headers = new Headers(init.headers || {})
    headers.set('x-bridge-token', token)
    addIdentityHeaders(headers, identity)
    return fetch(url, {...init, headers, signal: init.signal || AbortSignal.timeout(10_000)})
}

export function gatewayWsOptions(token, identity = null) {
    const headers = new Headers({'x-bridge-token': token})
    addIdentityHeaders(headers, identity)
    return {headers: Object.fromEntries(headers.entries()), handshakeTimeout: 10_000}
}
