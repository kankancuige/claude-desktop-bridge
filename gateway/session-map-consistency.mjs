/** 只接受正反向一致的 SDK conversation -> Gateway Session 映射。 */
export function resolveMappedGatewaySessionId(map, sdkSessionId) {
    const gatewaySessionId = map?.[`@rev:${sdkSessionId}`]
    if (typeof gatewaySessionId !== 'string' || !gatewaySessionId) return null
    return map[gatewaySessionId] === sdkSessionId ? gatewaySessionId : null
}

/** 更新正向映射时删除该 Gateway Session 的旧反向项，保持一一对应。 */
export function updateSessionMap(map, gatewaySessionId, sdkSessionId) {
    const next = {...(map || {})}
    const previousSdkSessionId = next[gatewaySessionId]
    if (previousSdkSessionId && previousSdkSessionId !== sdkSessionId
        && next[`@rev:${previousSdkSessionId}`] === gatewaySessionId) {
        delete next[`@rev:${previousSdkSessionId}`]
    }
    next[gatewaySessionId] = sdkSessionId
    next[`@rev:${sdkSessionId}`] = gatewaySessionId
    return next
}
