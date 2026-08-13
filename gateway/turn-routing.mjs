export function createTurnIdentity(source, userId, imSources) {
    if (!imSources?.has(source) || !userId) return null
    return {source: String(source), userId: String(userId)}
}

export function shouldDeliverTurnEvent(clientSource, clientUserId, identity) {
    if (clientSource === 'desktop') return true
    if (!identity) return false
    return clientSource === identity.source && clientUserId === identity.userId
}

export function shouldRouteMirror(platform, identity) {
    return !identity || platform === identity.source
}
