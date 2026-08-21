export type ModelContextSwitchMode = 'full_history' | 'handoff_summary' | 'cancel'

export interface ModelContextSwitchDecision {
  requiresChoice: boolean
  mode: ModelContextSwitchMode | 'reuse_same_session'
  cacheEligibility: 'same_partition_possible' | 'cross_model_unavailable' | 'unknown'
  reason: 'model_changed' | 'stable_model' | 'new_conversation' | 'automatic_routing'
}

/** SDK 初始化事件缺失模型时，保留 Gateway 已广播或持久化的上一回合实际路由模型。 */
export function resolveConversationModel({runtimeModel, taskModel, persistedModel}: {
  runtimeModel?: string
  taskModel?: string
  persistedModel?: string | null
}): string {
  return String(runtimeModel || '').trim()
    || String(taskModel || '').trim()
    || String(persistedModel || '').trim()
}

export function resolveModelContextSwitch({
  mode, currentModel, nextModel, hasConversation,
}: {mode: 'auto' | 'fixed'; currentModel?: string; nextModel?: string; hasConversation: boolean}): ModelContextSwitchDecision {
  if (mode === 'auto') {
    return {requiresChoice: false, mode: 'full_history', cacheEligibility: 'unknown', reason: 'automatic_routing'}
  }
  if (!hasConversation || !currentModel) {
    return {requiresChoice: false, mode: 'reuse_same_session', cacheEligibility: 'unknown', reason: 'new_conversation'}
  }
  if (currentModel === nextModel) {
    return {requiresChoice: false, mode: 'reuse_same_session', cacheEligibility: 'same_partition_possible', reason: 'stable_model'}
  }
  return {
    requiresChoice: true, mode: 'full_history', cacheEligibility: 'cross_model_unavailable', reason: 'model_changed',
  }
}
