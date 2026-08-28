/** 维护 SDK 工具调用活动快照，供长任务 watchdog 使用。 */
export function observeSessionToolActivity(session, sdkMsg = {}, clientEvent = null, timestamp = Date.now()) {
    if (!session || typeof session !== 'object') return
    if (!(session._activeTools instanceof Map)) session._activeTools = new Map()
    session._lastSdkEventAt = timestamp

    if (clientEvent?.type === 'tool_use_start') {
        const key = String(clientEvent.tool_use_id || `index:${clientEvent.index ?? session._activeTools.size}`)
        session._activeTools.set(key, {
            toolUseId: clientEvent.tool_use_id || null,
            index: clientEvent.index ?? null,
            toolName: clientEvent.tool_name || 'tool',
            startedAt: timestamp,
            lastProgressAt: timestamp,
        })
    } else if (clientEvent?.type === 'tool_progress') {
        const toolId = clientEvent.tool_use_id ? String(clientEvent.tool_use_id) : null
        const entry = toolId ? session._activeTools.get(toolId) : null
        if (entry) entry.lastProgressAt = timestamp
        else if (toolId) session._activeTools.set(toolId, {
            toolUseId: toolId, index: null, toolName: clientEvent.tool_name || 'tool',
            startedAt: timestamp, lastProgressAt: timestamp,
        })
    }
    if (sdkMsg.type === 'user') {
        for (const block of sdkMsg.message?.content || []) {
            if (block?.type === 'tool_result' && block.tool_use_id) session._activeTools.delete(String(block.tool_use_id))
        }
    }
    if (sdkMsg.type === 'result') session._activeTools.clear()
}

export function clearSessionToolActivity(session) {
    if (session?._activeTools instanceof Map) session._activeTools.clear()
}

/** 确认控制请求完成不一定伴随即时 SDK 消息，需要显式推进活动边界。 */
export function settleSessionToolConfirmation(session, entry, timestamp = Date.now()) {
    if (!session || !entry || typeof entry !== 'object') return
    session._lastSdkEventAt = timestamp
    if (!(session._activeTools instanceof Map) || !entry.toolUseId) return
    const key = String(entry.toolUseId)
    if (entry.type === 'choice' || entry.toolName === 'AskUserQuestion') {
        session._activeTools.delete(key)
        return
    }
    const active = session._activeTools.get(key)
    if (active) active.lastProgressAt = timestamp
}
