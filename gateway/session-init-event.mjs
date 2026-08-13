import {resolveContextWindow} from './context-lifecycle.mjs'

export function buildSystemInitEvent({sdkMsg, gatewaySessionId, modelInfo, modelMeta} = {}) {
    const historySessionId = typeof sdkMsg?.session_id === 'string' && sdkMsg.session_id
        ? sdkMsg.session_id
        : null
    const resolvedWindow = resolveContextWindow({
        providerContextWindow: modelInfo?.contextWindow || modelMeta?.contextWindow,
    })
    return {
        type: 'system_init',
        cwd: sdkMsg?.cwd,
        model: sdkMsg?.model,
        tools: sdkMsg?.tools,
        sessionId: gatewaySessionId,
        historySessionId,
        permissionMode: sdkMsg?.permissionMode,
        skills: sdkMsg?.skills,
        contextWindow: resolvedWindow.effectiveMaxTokens,
        contextWindowSource: resolvedWindow.source,
        pricing: modelInfo?.pricing || modelMeta?.pricing || null,
    }
}
