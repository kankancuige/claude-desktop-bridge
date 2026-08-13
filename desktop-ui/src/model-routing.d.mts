export type ModelMode = 'auto' | 'fixed'

export interface TaskDecisionDisplay {
  version?: number
  action?: string
  complexity?: string
  risk?: 'low' | 'medium' | 'high' | 'critical' | string
  modelTier?: 'light' | 'balanced' | 'power' | string
  model?: string
  modelMode?: ModelMode
  workflow?: string
  finalReview?: string
  reasons?: string[]
  hardTriggers?: string[]
  fallbackReason?: string | null
}

export function normalizeModelMode(mode: unknown): ModelMode
export function buildModelSelectionPayload(input?: {
  mode?: ModelMode
  model?: string
  modelMeta?: unknown
}): {modelMode: ModelMode, model?: string, modelMeta?: unknown}
export function describeTaskDecision(decision: TaskDecisionDisplay | null | undefined): string
