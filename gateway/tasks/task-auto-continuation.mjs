import {consumeTaskRunBudget, createTaskRunBudget, normalizeExecutionMode} from './task-execution-mode.mjs'

const MAX_ATTEMPTS_BY_TIER = Object.freeze({
    light: 1,
    balanced: 2,
    power: 3,
})

export const AUTO_CONTINUATION_MARKER = '[Bridge 自动续跑]'

export function isAutoContinuationPrompt(value) {
    return typeof value === 'string' && value.trimStart().startsWith(AUTO_CONTINUATION_MARKER)
}

function resolveTier(decision = {}) {
    const candidate = decision.modelTier || decision.complexity
    return candidate === 'light' || candidate === 'power' ? candidate : 'balanced'
}

/**
 * `maxTurns` 是单个 SDK query 的防失控边界，不等同于父任务完成。
 * 这里仅计算预算和暂停原因，实际是否继续必须由输入框播放按钮触发；其他失败交给正常错误流程。
 */
export function resolveAutoContinuation({
    result,
    decision,
    attempt = 0,
    hasConversation = false,
    taskActive = false,
    budget = null,
    progress = null,
    previousFingerprint = null,
} = {}) {
    const tier = resolveTier(decision)
    const maxAttempts = MAX_ATTEMPTS_BY_TIER[tier]
    const currentAttempt = Math.max(0, Math.trunc(Number(attempt) || 0))
    const explicitMode = Object.prototype.hasOwnProperty.call(decision || {}, 'executionMode')
    const mode = normalizeExecutionMode(explicitMode ? decision.executionMode : 'workflow')

    if (result?.outcome !== 'incomplete' || result?.continuationReason !== 'max_turns') {
        return {shouldContinue: false, reason: 'not_max_turns', mode, tier, attempt: currentAttempt, maxAttempts, prompt: ''}
    }
    if (mode === 'session') {
        return {shouldContinue: false, reason: 'session_mode', mode, tier, attempt: currentAttempt, maxAttempts, prompt: ''}
    }
    if (!taskActive) {
        return {shouldContinue: false, reason: 'task_inactive', mode, tier, attempt: currentAttempt, maxAttempts, prompt: ''}
    }
    if (!hasConversation) {
        return {shouldContinue: false, reason: 'conversation_unavailable', mode, tier, attempt: currentAttempt, maxAttempts, prompt: ''}
    }
    if (progress === false) {
        return {shouldContinue: false, reason: 'no_progress', mode, tier, attempt: currentAttempt, maxAttempts, prompt: ''}
    }
    if (previousFingerprint && result?.failureFingerprint && previousFingerprint === result.failureFingerprint) {
        return {shouldContinue: false, reason: 'no_progress', mode, tier, attempt: currentAttempt, maxAttempts, prompt: ''}
    }
    if (currentAttempt >= maxAttempts) {
        return {shouldContinue: false, reason: 'attempt_limit', mode, tier, attempt: currentAttempt, maxAttempts, prompt: ''}
    }
    const currentBudget = budget || createTaskRunBudget(decision?.continuationPolicy || {}, mode)
    const consumed = consumeTaskRunBudget(currentBudget, {
        rounds: 1,
        tokens: Number.isFinite(Number(result?.usage?.input_tokens)) && Number.isFinite(Number(result?.usage?.output_tokens))
            ? Math.max(0, Number(result.usage.input_tokens) + Number(result.usage.output_tokens)) : 0,
    })
    if (!consumed.allowed) {
        return {shouldContinue: false, reason: consumed.reason, mode, tier, attempt: currentAttempt, maxAttempts, prompt: '', budget: consumed.budget || currentBudget, remaining: consumed.remaining}
    }

    const nextAttempt = currentAttempt + 1
    return {
        shouldContinue: true,
        reason: 'max_turns',
        mode,
        tier,
        attempt: nextAttempt,
        maxAttempts,
        budget: consumed.budget,
        remaining: consumed.remaining,
        prompt: [
            AUTO_CONTINUATION_MARKER,
            '继续当前尚未完成的任务，不要重新开始，也不要只总结进度。',
            '先依据当前会话、已有修改和最近工具结果确认未完成项，然后继续实现与验证。',
            '只有任务目标真正完成或遇到需要用户决定的真实阻塞时才结束。',
        ].join('\n'),
    }
}
