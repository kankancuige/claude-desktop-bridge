const RESULT_REASONS = new Map([
    ['error_max_turns', 'max_turns'],
    ['error_max_budget_usd', 'max_budget'],
    ['error_during_execution', 'execution_error'],
    ['error_max_structured_output_retries', 'structured_output'],
])

export function looksLikeIncompleteTransportFailure(value) {
    const text = String(value || '').trim()
    return /(?:API\s+Error\s*:\s*)?(?:Connection closed mid-response|response above may be incomplete)/i.test(text)
}

export function classifyTaskResult(sdkMsg = {}) {
    const subtype = String(sdkMsg?.subtype || '')
    if (subtype === 'success' && sdkMsg?.is_error !== true) {
        // 部分中转站会把断流文本包装在 success result 中；不能仅凭 subtype 判定任务成功。
        const transportText = [sdkMsg?.result, sdkMsg?.finalText, ...(Array.isArray(sdkMsg?.errors) ? sdkMsg.errors : [])]
            .filter(Boolean).join('\n')
        if (looksLikeIncompleteTransportFailure(transportText)) {
            return {
                outcome: 'failed',
                continuationReason: 'execution_error',
                incomplete: false,
            }
        }
        return {
            outcome: 'succeeded',
            continuationReason: null,
            incomplete: false,
        }
    }
    if (subtype === 'error_max_turns') {
        return {
            outcome: 'incomplete',
            continuationReason: 'max_turns',
            incomplete: true,
        }
    }
    return {
        outcome: 'failed',
        continuationReason: RESULT_REASONS.get(subtype) || 'unknown_error',
        incomplete: false,
    }
}
export function canResumeTask(result, hasConversation) {
    if (!hasConversation || result?.outcome === 'succeeded') return false
    return result?.continuationReason !== 'max_budget'
}

export function buildIncompleteMirrorText(text, result = {}) {
    const body = String(text || '').trim()
    if (result.outcome === 'succeeded') return body

    let notice
    switch (result.continuationReason) {
        case 'max_turns':
            notice = '任务尚未完成：已达到单次最大轮数。请在桌面端点击“继续执行”，或在当前会话回复“继续”。'
            break
        case 'max_budget':
            notice = '任务尚未完成：已达到本次预算限制。请调整预算后继续。'
            break
        default:
            notice = '任务尚未完成：执行过程中发生错误。已保留当前会话和已有修改，可在当前会话继续。'
            break
    }
    return body ? `${body}\n\n[Bridge] ${notice}` : `[Bridge] ${notice}`
}
