export interface SessionDraft {
  text: string
  updatedAt: number
  interrupted: boolean
}
export interface SessionDraftStore {
  version: 1
  drafts: Record<string, SessionDraft>
}

export interface DraftStoreLimits {
  retentionMs?: number
  maxEntries?: number
  maxTextLength?: number
}

export interface DraftIdentity {
  historySessionId?: string | null
  workDir?: string | null
  gatewaySessionId?: string | null
}

export interface SessionDraftTaskState {
  status?: unknown
  resumable?: unknown
}

const VERSION = 1 as const
export const SESSION_DRAFTS_STORAGE_KEY = 'bridge-session-drafts-v1'
export const DEFAULT_DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const DEFAULT_MAX_DRAFTS = 100
export const DEFAULT_MAX_DRAFT_TEXT_LENGTH = 900_000

function emptyStore(): SessionDraftStore {
  return {version: VERSION, drafts: {}}
}

function cleanKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 2048) : ''
}

export function sessionDraftKey(identity: DraftIdentity): string {
  const historySessionId = cleanKey(identity.historySessionId)
  if (historySessionId) return `sdk:${historySessionId}`
  const workDir = cleanKey(identity.workDir).replace(/\\/g, '/').toLowerCase()
  const gatewaySessionId = cleanKey(identity.gatewaySessionId)
  return workDir && gatewaySessionId ? `gateway:${workDir}:${gatewaySessionId}` : ''
}

export function parseSessionDraftStore(
  raw: string | null | undefined,
  now = Date.now(),
  limits: DraftStoreLimits = {},
): SessionDraftStore {
  if (!raw) return emptyStore()
  const retentionMs = limits.retentionMs ?? DEFAULT_DRAFT_RETENTION_MS
  const maxTextLength = limits.maxTextLength ?? DEFAULT_MAX_DRAFT_TEXT_LENGTH
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || !value.drafts || typeof value.drafts !== 'object') return emptyStore()
    const drafts: Record<string, SessionDraft> = {}
    for (const [rawKey, rawDraft] of Object.entries(value.drafts)) {
      const key = cleanKey(rawKey)
      const draft = rawDraft as Partial<SessionDraft>
      if (!key || typeof draft?.text !== 'string' || !Number.isFinite(draft.updatedAt)) continue
      if (retentionMs >= 0 && now - Number(draft.updatedAt) > retentionMs) continue
      drafts[key] = {
        text: draft.text.slice(0, maxTextLength),
        updatedAt: Number(draft.updatedAt),
        interrupted: draft.interrupted === true,
      }
    }
    return {version: VERSION, drafts}
  } catch {
    return emptyStore()
  }
}

export function upsertSessionDraft(
  store: SessionDraftStore,
  rawKey: string,
  text: string,
  options: DraftStoreLimits & {now?: number; interrupted?: boolean} = {},
): SessionDraftStore {
  const key = cleanKey(rawKey)
  if (!key) return store
  const maxTextLength = options.maxTextLength ?? DEFAULT_MAX_DRAFT_TEXT_LENGTH
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_DRAFTS)
  const drafts = {...store.drafts}
  drafts[key] = {
    text: String(text || '').slice(0, maxTextLength),
    updatedAt: options.now ?? Date.now(),
    interrupted: options.interrupted === true,
  }
  const ordered = Object.entries(drafts).sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  return {version: VERSION, drafts: Object.fromEntries(ordered.slice(0, maxEntries))}
}

export function getSessionDraft(store: SessionDraftStore, rawKey: string): SessionDraft | null {
  const key = cleanKey(rawKey)
  return key && store.drafts[key] ? {...store.drafts[key]} : null
}

export function shouldRestoreSessionDraft(
  draft: SessionDraft,
  taskState: SessionDraftTaskState | null | undefined,
): boolean {
  if (!draft.interrupted) return true
  const status = String(taskState?.status || '')
  return ['failed', 'incomplete', 'interrupted', 'stopped', 'review_paused'].includes(status)
}

/** 中断任务文本用于恢复，不应伪装成等待发送的用户草稿。 */
export function shouldPresentSessionDraftInComposer(
  draft: SessionDraft,
  taskState: SessionDraftTaskState | null | undefined,
): boolean {
  return !draft.interrupted && shouldRestoreSessionDraft(draft, taskState)
}

export function removeSessionDraft(store: SessionDraftStore, rawKey: string): SessionDraftStore {
  const key = cleanKey(rawKey)
  if (!key || !store.drafts[key]) return store
  const drafts = {...store.drafts}
  delete drafts[key]
  return {version: VERSION, drafts}
}

export function removeMatchingInterruptedSessionDraft(
  store: SessionDraftStore,
  rawKey: string,
  taskText: string,
): SessionDraftStore {
  const key = cleanKey(rawKey)
  const draft = key ? store.drafts[key] : null
  const expectedText = String(taskText || '').trim()
  if (!draft?.interrupted || !expectedText || draft.text.trim() !== expectedText) return store
  return removeSessionDraft(store, key)
}

export function readSessionDraftStore(storage: Pick<Storage, 'getItem'>): SessionDraftStore {
  return parseSessionDraftStore(storage.getItem(SESSION_DRAFTS_STORAGE_KEY))
}

export function writeSessionDraftStore(storage: Pick<Storage, 'setItem'>, store: SessionDraftStore): void {
  storage.setItem(SESSION_DRAFTS_STORAGE_KEY, JSON.stringify(store))
}
