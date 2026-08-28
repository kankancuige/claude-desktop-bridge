const MAX_CONTEXT_TOKEN_LENGTH = 4096
const MAX_CONTEXT_USERS = 5000

export function rememberWeChatContext(contexts, userId, contextToken) {
    const uid = String(userId || '').trim()
    const ctx = String(contextToken || '').trim()
    if (!uid || !ctx || ctx.length > MAX_CONTEXT_TOKEN_LENGTH) return false
    contexts.set(uid, ctx)
    while (contexts.size > MAX_CONTEXT_USERS) contexts.delete(contexts.keys().next().value)
    return true
}

export function resolveWeChatContext(contexts, userId, contextToken) {
    const current = String(contextToken || '').trim()
    if (current) return current
    return contexts.get(String(userId || '').trim()) || ''
}
