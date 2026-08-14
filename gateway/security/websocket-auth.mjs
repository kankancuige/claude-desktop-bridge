export const BRIDGE_WS_PROTOCOL = 'claude-bridge-v1'
export const BRIDGE_WS_AUTH_PREFIX = 'claude-bridge-auth.'

function normalizeTokenCandidate(value) {
    const token = typeof value === 'string' ? value : ''
    return /^[A-Za-z0-9._~-]{1,256}$/.test(token) ? token : ''
}

export function extractWebSocketToken(req) {
    const headerToken = req?.headers?.['x-bridge-token']
    if (typeof headerToken === 'string' && headerToken) return normalizeTokenCandidate(headerToken)

    const protocols = String(req?.headers?.['sec-websocket-protocol'] || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
    const authProtocol = protocols.find(value => value.startsWith(BRIDGE_WS_AUTH_PREFIX))
    if (authProtocol) return normalizeTokenCandidate(authProtocol.slice(BRIDGE_WS_AUTH_PREFIX.length))

    // token 不接受 URL query，避免被代理日志、崩溃报告或历史记录泄露。
    return ''
}

export function buildWebSocketProtocols(token) {
    const value = String(token || '')
    return value ? [BRIDGE_WS_PROTOCOL, `${BRIDGE_WS_AUTH_PREFIX}${value}`] : []
}
