export function createRepairLoop({maxAutomaticAttempts = 2} = {}) {
    const failures = new Map()
    return {
        recordFailure({fingerprint, strategy, regression = false, externalBlocker = false, reproducible = true, rca = null} = {}) {
            if (!fingerprint) throw new TypeError('修复循环需要失败指纹')
            if (externalBlocker) return {action: 'stop', status: 'blocked_external', reason: 'external_blocker'}
            if (!reproducible) return {action: 'stop', status: 'awaiting_reproduction', reason: 'not_reproducible'}
            if (regression) return {action: 'freeze', status: 'regression_detected', reason: 'new_regression'}
            const history = failures.get(fingerprint) || []
            if (history.some(item => item.strategy === strategy)) return {action: 'rca', status: 'diagnosis_required', reason: 'strategy_repeated'}
            history.push({strategy: String(strategy || ''), rca: rca || null})
            failures.set(fingerprint, history)
            if (history.length <= maxAutomaticAttempts) return {action: 'retry', status: 'running', attempt: history.length}
            if (rca?.newRootCause && rca?.newStrategy) return {action: 'retry', status: 'running', attempt: history.length, reason: 'rca_new_strategy'}
            return {action: 'stop', status: 'diagnosis_required', reason: 'repair_budget_exhausted'}
        },
        snapshot(fingerprint) {
            return [...(failures.get(fingerprint) || [])]
        },
    }
}

export function classifyRcaOutcome(input = {}) {
    if (input.externalBlocker) return 'blocked_external'
    if (input.architectureBoundary) return 'architecture_change_required'
    if (input.reproducible === false) return 'awaiting_reproduction'
    return 'diagnosis_required'
}
