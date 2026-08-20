export interface ConnectedSessionSelection {
  requestedWorkDir: string
  requestedHistorySessionId?: string
  activeTabId?: string | null
  tabId?: string | null
  tabProjectPath?: string | null
  activeProjectPath?: string | null
  activeHistorySessionId?: string | null
  tabHistorySessionId?: string | null
  activeGatewaySessionId?: string | null
  tabGatewaySessionId?: string | null
  socketReadyState?: number
  connected?: boolean
}

export function resolveExistingSessionTarget(response: any, fallbackId: string | null | undefined): string | null {
  if (response?.exists !== true) return null
  const resolved = typeof response.sessionId === 'string' ? response.sessionId.trim() : ''
  return resolved || String(fallbackId || '').trim() || null
}

/** SDK 会话 ID 已知时，Gateway 运行态必须绑定同一个 conversation。 */
export function runtimeSessionMatchesHistory(requested: string | null | undefined, actual: string | null | undefined): boolean {
  const requestedId = String(requested || '').trim()
  const actualId = String(actual || '').trim()
  return !actualId || !requestedId || requestedId === actualId
}

export function classifySessionExistsResponse(ok: boolean, status: number): 'exists' | 'missing' | 'unavailable' {
  if (ok) return 'exists'
  if (status === 404) return 'missing'
  return 'unavailable'
}

export type SessionRuntimeRecoveryDecision =
  | {kind: 'reuse'; sessionId: string}
  | {kind: 'recreate'}
  | {kind: 'reset'}
  | {kind: 'unavailable'; reason: string}

/** 将 HTTP、Gateway runtime 和 SDK history 三种身份统一为一个恢复决策。 */
export function decideSessionRuntimeRecovery({
  ok,
  status,
  response,
  historySessionId,
  fallbackSessionId,
}: {
  ok: boolean
  status: number
  response: any
  historySessionId?: string | null
  fallbackSessionId?: string | null
}): SessionRuntimeRecoveryDecision {
  const hasHistory = !!String(historySessionId || '').trim()
  const existsStatus = classifySessionExistsResponse(ok, status)
  if (existsStatus === 'missing') return {kind: hasHistory ? 'recreate' : 'reset'}
  if (existsStatus === 'unavailable') return {kind: 'unavailable', reason: `HTTP ${status}`}
  if (response?.exists !== true) return {kind: 'unavailable', reason: 'Gateway 返回了无效的会话状态'}
  if (!runtimeSessionMatchesHistory(historySessionId, response?.historySessionId)) {
    return {kind: hasHistory ? 'recreate' : 'reset'}
  }
  const sessionId = resolveExistingSessionTarget(response, fallbackSessionId)
  return sessionId ? {kind: 'reuse', sessionId} : {kind: 'unavailable', reason: 'Gateway 未返回运行会话 ID'}
}

function normalizeProjectPath(value: string | null | undefined): string {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 判断侧栏目标是否就是当前标签页的同一 SDK 会话，不依赖瞬时连接状态。 */
export function isSameSessionSelection(input: ConnectedSessionSelection): boolean {
  const requestedHistorySessionId = String(input.requestedHistorySessionId || '')
  if (!requestedHistorySessionId) return false
  return input.activeTabId === input.tabId
    && input.activeTabId !== null
    && input.activeTabId !== undefined
    && normalizeProjectPath(input.requestedWorkDir) === normalizeProjectPath(input.tabProjectPath)
    && normalizeProjectPath(input.requestedWorkDir) === normalizeProjectPath(input.activeProjectPath)
    && requestedHistorySessionId === input.activeHistorySessionId
    && requestedHistorySessionId === input.tabHistorySessionId
    && !!input.activeGatewaySessionId
    && input.activeGatewaySessionId === input.tabGatewaySessionId
}

/** 当前侧栏目标已经是前台且连接可用时，直接复用现有状态和 WebSocket。 */
export function shouldReuseConnectedSession(input: ConnectedSessionSelection): boolean {
  return isSameSessionSelection(input) && !!input.connected && input.socketReadyState === 1
}

/** 本地标签身份一致但连接已丢失时，必须先向 Gateway 验证 runtime，不能直接连接持久化的旧 UUID。 */
export function shouldValidateSessionRuntime(input: ConnectedSessionSelection): boolean {
  return isSameSessionSelection(input) && !shouldReuseConnectedSession(input)
}

/**
 * 仅当当前全局 socket 就属于即将重连的同一会话时才关闭它。
 * 切换标签页时，旧标签页的 socket 仍归旧 tab 管理，不能被新 tab 的连接流程误关。
 */
export function shouldCloseSocketBeforeConnect(
  currentSessionId: string | null | undefined,
  targetSessionId: string | null | undefined,
  socketReadyState: number | null | undefined,
): boolean {
  return !!currentSessionId
    && !!targetSessionId
    && currentSessionId === targetSessionId
    && socketReadyState !== 3
}
