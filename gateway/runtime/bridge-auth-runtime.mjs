import crypto from 'node:crypto'

/** Gateway/Adapter token认证和安全 URI 解码端口。 */
export function createBridgeAuthRuntime({
    bridgeHome,
    bridgeTokenPath,
    bridgeToken,
    adapterTokens,
    mkdirSync,
    writeFileSync,
} = {}) {
    if (!bridgeHome || !bridgeTokenPath || typeof bridgeToken !== 'string' || !(adapterTokens instanceof Map)
        || typeof mkdirSync !== 'function' || typeof writeFileSync !== 'function') {
        throw new TypeError('bridge auth dependencies are required')
    }
    function persistBridgeToken() {
        mkdirSync(bridgeHome, {recursive: true})
        writeFileSync(bridgeTokenPath, bridgeToken, {encoding: 'utf8', mode: 0o600})
    }
    function tokenMatches(received, expected) {
        if (typeof received !== 'string' || typeof expected !== 'string') return false
        const a = Buffer.from(received)
        const b = Buffer.from(expected)
        return a.length === b.length && crypto.timingSafeEqual(a, b)
    }
    function authenticateBridgeToken(received) {
        if (tokenMatches(received, bridgeToken)) return {kind: 'desktop'}
        for (const [platform, token] of adapterTokens) if (tokenMatches(received, token)) return {kind: 'adapter', platform}
        return null
    }
    function safeDecodeURIComponent(value) {
        try { return decodeURIComponent(String(value || '')) } catch { return '' }
    }
    return {persistBridgeToken, tokenMatches, authenticateBridgeToken, safeDecodeURIComponent}
}
