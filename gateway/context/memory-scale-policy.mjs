export const DEFAULT_MEMORY_SCALE_THRESHOLDS = Object.freeze({
    summaryCount: 100,
    hierarchyCount: 500,
    keywordRecallThreshold: 0.8,
    hierarchyRecallThreshold: 0.55,
    injectionBudgetBytes: 6 * 1024,
})

function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
}

function promote(mode, target) {
    const order = ['flat', 'summary', 'hierarchical']
    return order[Math.max(order.indexOf(mode), order.indexOf(target))]
}

export function decideMemoryScalePolicy({count = 0, keywordRecall = null, injectionBytes = 0, thresholds = {}} = {}) {
    const config = {...DEFAULT_MEMORY_SCALE_THRESHOLDS, ...(thresholds && typeof thresholds === 'object' ? thresholds : {})}
    const total = Math.max(0, Math.trunc(Number(count) || 0))
    const recall = finiteNumber(keywordRecall)
    const injected = Math.max(0, Number(injectionBytes) || 0)
    let mode = total >= Number(config.hierarchyCount) ? 'hierarchical' : total >= Number(config.summaryCount) ? 'summary' : 'flat'
    let reason = total >= Number(config.hierarchyCount) ? 'memory_count_high' : total >= Number(config.summaryCount) ? 'memory_count_growing' : 'memory_count_small'
    if (recall !== null && recall < Number(config.hierarchyRecallThreshold)) {
        mode = promote(mode, 'hierarchical')
        reason = 'keyword_recall_low'
    } else if (recall !== null && recall < Number(config.keywordRecallThreshold)) {
        mode = promote(mode, 'summary')
        reason = 'keyword_recall_degraded'
    }
    if (injected >= Number(config.injectionBudgetBytes) * 0.98) {
        mode = promote(mode, 'hierarchical')
        reason = 'injection_budget_exhausted'
    } else if (injected >= Number(config.injectionBudgetBytes) * 0.9) {
        mode = promote(mode, 'summary')
        reason = 'injection_budget_near_limit'
    }
    return {
        mode,
        reason,
        count: total,
        keywordRecall: recall,
        injectionBytes: injected,
        shouldBackfill: mode !== 'flat',
        shouldUseHierarchy: mode === 'hierarchical',
        thresholds: config,
    }
}
