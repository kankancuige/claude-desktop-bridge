import {compareContextEnvelopes} from './context-envelope.mjs'

function selectedMode(switchIntent) {
    if (switchIntent === 'handoff_summary') return 'handoff_summary'
    if (switchIntent === 'start_fresh') return 'start_fresh'
    return 'rebuild_full_history'
}

function selectedReason(switchIntent) {
    if (switchIntent === 'handoff_summary') return 'handoff_summary_selected'
    if (switchIntent === 'start_fresh') return 'start_fresh_selected'
    if (switchIntent === 'full_history') return 'full_history_selected'
    return 'user_choice_required'
}

/**
 * 仅判断本地可证明的上下文连续性和 Provider 缓存资格边界。
 * 任何 `same_partition_possible` 都不是 Provider cache hit，也不代表计费折扣。
 */
export function resolveContextReusePolicy({previous = null, next = null, providerCapability = null, switchIntent = 'unspecified'} = {}) {
    if (!previous || !next) {
        return {
            mode: 'start_fresh', cacheEligibility: 'unknown',
            reasonCodes: ['no_previous_envelope'], requiresUserChoice: false,
        }
    }
    const comparison = compareContextEnvelopes(previous, next)
    const modelChanged = comparison.changedDimensions.includes('model')
    const providerChanged = comparison.changedDimensions.includes('provider')
    if (modelChanged || providerChanged) {
        const explicit = switchIntent === 'full_history' || switchIntent === 'handoff_summary' || switchIntent === 'start_fresh'
        return {
            mode: selectedMode(switchIntent),
            cacheEligibility: 'cross_model_unavailable',
            reasonCodes: [modelChanged ? 'model_changed' : 'provider_changed', selectedReason(switchIntent)],
            requiresUserChoice: !explicit,
        }
    }
    if (!comparison.sameCachePartition) {
        const changedDimension = comparison.changedDimensions[0] || 'context_fingerprint'
        const reason = `${changedDimension}_changed`
        return {
            mode: selectedMode(switchIntent), cacheEligibility: 'unknown',
            reasonCodes: [reason, selectedReason(switchIntent) === 'user_choice_required' ? 'context_rebuild_required' : selectedReason(switchIntent)],
            requiresUserChoice: false,
        }
    }
    if (!next.resumeAvailable) {
        return {
            mode: 'start_fresh', cacheEligibility: 'same_partition_possible',
            reasonCodes: ['stable_partition', 'resume_unavailable'], requiresUserChoice: false,
        }
    }
    const capability = providerCapability?.cacheUsage
    const capabilityReason = capability === 'unsupported' ? 'provider_cache_usage_unavailable' : 'resume_available'
    return {
        mode: 'reuse_same_session', cacheEligibility: 'same_partition_possible',
        reasonCodes: ['stable_partition', capabilityReason], requiresUserChoice: false,
    }
}
