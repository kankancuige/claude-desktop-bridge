export function resolveSessionResume({
    requestedResume,
    activeGatewaySessionId,
    activeSdkSessionId,
    mappedSdkSessionId,
    mappedGatewaySessionId,
    transcriptExists = false,
    newGatewaySessionId,
} = {}) {
    if (!requestedResume) {
        return {mode: 'new', gatewaySessionId: null, sdkSessionId: null}
    }
    if (activeGatewaySessionId && (
        activeSdkSessionId === requestedResume
        || (!transcriptExists && activeGatewaySessionId === requestedResume)
    )) {
        return {mode: 'resume', gatewaySessionId: activeGatewaySessionId, sdkSessionId: activeSdkSessionId || requestedResume}
    }
    // 明确请求且已验证存在的 transcript 是 SDK conversation 的权威身份。
    // 正向映射只兼容旧客户端传入 Gateway UUID 的情况，不能覆盖用户点击的 SDK ID。
    if (transcriptExists) {
        return {
            mode: 'resume',
            gatewaySessionId: mappedGatewaySessionId || newGatewaySessionId || requestedResume,
            sdkSessionId: requestedResume,
        }
    }
    if (mappedSdkSessionId) return {mode: 'resume', gatewaySessionId: requestedResume, sdkSessionId: mappedSdkSessionId}
    if (mappedGatewaySessionId) {
        return {mode: 'resume', gatewaySessionId: mappedGatewaySessionId, sdkSessionId: requestedResume}
    }
    return {mode: 'missing', gatewaySessionId: null, sdkSessionId: null}
}
