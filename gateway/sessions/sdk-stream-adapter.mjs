import {mapStreamEvent} from './stream-event-mapper.mjs'

/**
 * SDK stream 适配器不拥有 session 状态或终态判断，只隔离 SDK 消息形状与公开桌面事件之间的映射。
 */
export function createSdkStreamAdapter({
    getSession = () => null,
    lookupModelInfo = () => null,
    buildSystemInitEvent,
    buildAgentDescriptor,
    compactBoundaryToEvent,
    isSyntheticCompactSummary = () => false,
    isInternalWorkflowResultText = () => false,
    isAutoContinuationPrompt = () => false,
    classifyTaskResult,
    canResumeTask,
    now = () => Date.now(),
} = {}) {
    if (typeof buildSystemInitEvent !== 'function' || typeof buildAgentDescriptor !== 'function'
        || typeof compactBoundaryToEvent !== 'function' || typeof classifyTaskResult !== 'function'
        || typeof canResumeTask !== 'function') {
        throw new TypeError('SDK Stream Adapter 缺少必需转换依赖')
    }

    return {
        toClientEvent(sdkMsg = {}, sessionId) {
            switch (sdkMsg.type) {
                case 'system': {
                    if (sdkMsg.subtype === 'init') {
                        const session = getSession(sessionId)
                        return buildSystemInitEvent({
                            sdkMsg,
                            gatewaySessionId: sessionId,
                            modelInfo: lookupModelInfo(sdkMsg.model),
                            modelMeta: session?.modelMeta,
                        })
                    }
                    if (sdkMsg.subtype === 'compact_boundary') return compactBoundaryToEvent(sdkMsg)
                    if (sdkMsg.subtype === 'task_started') {
                        const session = getSession(sessionId)
                        const agentType = String(sdkMsg.subagent_type || sdkMsg.task_type || 'unknown')
                        const descriptor = buildAgentDescriptor(agentType, {
                            description: sdkMsg.description,
                            prompt: sdkMsg.prompt,
                        }, session?.queryOpts?.agents || {})
                        return {
                            type: 'subagent_start', agentId: sdkMsg.task_id, toolUseId: sdkMsg.tool_use_id || null,
                            agentType, description: descriptor.task || descriptor.purpose, ...descriptor, ts: now(),
                        }
                    }
                    if (sdkMsg.subtype === 'task_progress') return {
                        type: 'subagent_progress', agentId: sdkMsg.task_id, toolUseId: sdkMsg.tool_use_id || null,
                        agentType: sdkMsg.subagent_type || 'unknown',
                        currentAction: sdkMsg.last_tool_name || sdkMsg.description || '',
                        progress: sdkMsg.summary || sdkMsg.description || '', usage: sdkMsg.usage || null, ts: now(),
                    }
                    if (sdkMsg.subtype === 'task_notification') return {
                        type: 'subagent_done', agentId: sdkMsg.task_id, toolUseId: sdkMsg.tool_use_id || null,
                        status: sdkMsg.status, summary: sdkMsg.summary || '', usage: sdkMsg.usage || null, ts: now(),
                    }
                    return null
                }
                case 'stream_event':
                    return mapStreamEvent(sdkMsg.event)
                case 'assistant':
                    return {type: 'assistant_message', message: sdkMsg.message, error: sdkMsg.error}
                case 'user': {
                    if (isSyntheticCompactSummary(sdkMsg)) return null
                    const userText = sdkMsg.message?.content?.find?.(block => block?.type === 'text')?.text
                    if (isInternalWorkflowResultText(userText) || isAutoContinuationPrompt(userText)) return null
                    return {type: 'user_message_echo', message: sdkMsg.message, timestamp: sdkMsg.timestamp}
                }
                case 'result': {
                    const taskResult = classifyTaskResult(sdkMsg)
                    const session = getSession(sessionId)
                    return {
                        type: 'result', subtype: sdkMsg.subtype, duration_ms: sdkMsg.duration_ms,
                        is_error: sdkMsg.is_error, num_turns: sdkMsg.num_turns,
                        result: sdkMsg.result || sdkMsg.errors?.join('\n'), usage: sdkMsg.usage,
                        modelUsage: sdkMsg.modelUsage, ...taskResult,
                        resumable: canResumeTask(taskResult, Boolean(session?.lastSessionId || sdkMsg.session_id)),
                    }
                }
                case 'tool_progress':
                    return {
                        type: 'tool_progress', tool_use_id: sdkMsg.tool_use_id,
                        tool_name: sdkMsg.tool_name, elapsed_time_seconds: sdkMsg.elapsed_time_seconds,
                    }
                default:
                    return null
            }
        },
    }
}
