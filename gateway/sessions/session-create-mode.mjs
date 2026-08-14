function optionalSessionId(value, field) {
    if (value === undefined || value === null) return null
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`invalid ${field}`)
    return value.trim()
}

/** 解析互斥的会话创建语义，避免恢复/分支静默降级为空白会话。 */
export function resolveSessionCreateMode(body = {}) {
    const resume = optionalSessionId(body.resume, 'resume')
    const forkFrom = optionalSessionId(body.forkFrom, 'forkFrom')
    if (resume && forkFrom) throw new TypeError('resume and forkFrom are mutually exclusive')
    if (resume) return {mode: 'resume', sourceSessionId: resume}
    if (forkFrom) return {mode: 'fork', sourceSessionId: forkFrom}
    return {mode: 'new', sourceSessionId: null}
}

/** 恢复和分支 runtime 在 SDK 首个事件前就必须具有稳定 conversation identity。 */
export function initialSessionIdentity(sourceSessionId) {
    const id = optionalSessionId(sourceSessionId, 'sourceSessionId')
    return {
        hasUserTurns: Boolean(id),
        lastSessionId: id,
        _hasConversation: Boolean(id),
    }
}
