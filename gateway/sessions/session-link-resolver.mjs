function value(input, max = 240) { return typeof input === 'string' ? input.trim().slice(0, max) : '' }

function unavailable(projectKey, task, reason = 'session_unavailable') {
    return {projectKey, encodedDir: null, sessionId: null, sdkSessionId: value(task?.sdkSessionId, 240) || null, historySessionId: value(task?.historySessionId, 240) || null, turnId: value(task?.turnId, 240) || null, available: false, reason}
}

export function resolveSessionLink({task, projectKey, lookupGatewaySessionId = () => null, lookupSdkSessionId = () => null, findTranscript = () => null} = {}) {
    const owner = value(projectKey, 240)
    if (!owner || !task || (task.projectKey && value(task.projectKey, 240) !== owner)) return unavailable(owner, task, 'project_mismatch')
    const taskGatewayId = value(task.sessionId, 240)
    const historyId = value(task.historySessionId, 240)
    const sdkId = value(task.sdkSessionId, 240)
    const candidates = []
    if (taskGatewayId) candidates.push({sessionId: taskGatewayId, sdkSessionId: sdkId || value(lookupSdkSessionId(owner, taskGatewayId), 240), historySessionId: historyId || sdkId})
    if (historyId && !candidates.some(item => item.sessionId === historyId)) candidates.push({sessionId: value(lookupGatewaySessionId(owner, historyId), 240), sdkSessionId: sdkId || historyId, historySessionId: historyId})
    if (sdkId && !candidates.some(item => item.sessionId)) candidates.push({sessionId: value(lookupGatewaySessionId(owner, sdkId), 240), sdkSessionId: sdkId, historySessionId: historyId || sdkId})
    for (const candidate of candidates) {
        if (!candidate.sessionId) continue
        const transcript = findTranscript({projectKey: owner, sessionId: candidate.sessionId, sdkSessionId: candidate.sdkSessionId}) || null
        if (!transcript || transcript.status === 'missing' || transcript.status === 'ambiguous' || (transcript.projectKey && value(transcript.projectKey, 240) !== owner)) continue
        // encodedDir 是项目编码 key，必须返回本次校验过的 owner，不能透传 transcript 的解码路径。
        return {projectKey: owner, encodedDir: owner, sessionId: candidate.sessionId, sdkSessionId: candidate.sdkSessionId || null, historySessionId: candidate.historySessionId || null, turnId: value(task.turnId, 240) || null, available: true}
    }
    return unavailable(owner, task)
}
