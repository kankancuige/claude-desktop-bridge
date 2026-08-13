export type BridgeNoticeSeverity = 'info' | 'warning' | 'error'
export type BridgeNoticeSource = 'http' | 'websocket' | 'storage' | 'session'

export interface BridgeNotice {
  code: string
  severity: BridgeNoticeSeverity
  message: string
  source: BridgeNoticeSource
  status?: number
  path?: string
  retryable: boolean
  dedupeKey: string
}

export interface BridgeFailureInput {
  error?: unknown
  status?: number
  path?: string
  source?: BridgeNoticeSource
  serverCode?: string
  serverMessage?: string
}

const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[^\s,;]+/gi,
  /\b(?:api[_-]?key|token|secret|password|passwd|authorization)\s*[:=]\s*[^\s,;]+/gi,
  /\bsk-[A-Za-z0-9._-]{6,}/g,
]

export function sanitizeErrorMessage(value: unknown, maxLength = 300): string {
  let text = String(value || '').replace(/[\r\n\t]+/g, ' ').trim()
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[REDACTED]')
  return text.slice(0, maxLength)
}

export function shouldNotifyHttpStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error && 'name' in error ? String((error as {name?: unknown}).name || '') : ''
}

function errorMessage(error: unknown): string {
  return typeof error === 'object' && error && 'message' in error
    ? String((error as {message?: unknown}).message || '')
    : String(error || '')
}

export function classifyBridgeFailure(input: BridgeFailureInput): BridgeNotice {
  const status = Number(input.status || 0) || undefined
  const path = String(input.path || '')
  const source = input.source || 'http'
  const name = errorName(input.error)
  const rawMessage = sanitizeErrorMessage(input.serverMessage || errorMessage(input.error))
  let code = input.serverCode || 'GATEWAY_REQUEST_FAILED'
  let message = rawMessage || '请求失败，请稍后重试'
  let retryable = true
  let severity: BridgeNoticeSeverity = 'error'

  if (source === 'storage') {
    code = 'LOCAL_STORAGE_FAILED'
    message = '本地会话状态保存失败，关闭应用前请保留当前输入内容'
    retryable = false
  } else if (source === 'websocket') {
    code = input.serverCode || 'WEBSOCKET_CONNECTION_FAILED'
    message = rawMessage || '实时连接异常，正在尝试恢复'
  } else if (name === 'TimeoutError' || status === 408) {
    code = 'GATEWAY_TIMEOUT'
    message = '请求超时，请检查 Gateway 或供应商连接后重试'
  } else if (input.error && (name === 'TypeError' || /failed to fetch|network|econnrefused/i.test(rawMessage))) {
    code = 'GATEWAY_UNAVAILABLE'
    message = '无法连接 Gateway，正在等待服务恢复'
  } else if (status === 401 || status === 403) {
    code = 'GATEWAY_AUTH_FAILED'
    message = 'Gateway 本地认证失败，请等待自动刷新或重启应用'
    retryable = false
  } else if (status === 429) {
    code = 'API_RATE_LIMITED'
    message = '请求过于频繁，已被限流，请稍后重试'
    severity = 'warning'
  } else if (status && status >= 500) {
    code = input.serverCode || 'GATEWAY_SERVER_ERROR'
    message = rawMessage && rawMessage !== 'Internal Server Error'
      ? `服务处理失败：${rawMessage}`
      : 'Gateway 或供应商服务异常，请稍后重试'
  }

  return {
    code,
    severity,
    message,
    source,
    status,
    path: path || undefined,
    retryable,
    dedupeKey: `${source}:${code}:${status || 0}:${path}`,
  }
}

export function dispatchBridgeNotice(notice: BridgeNotice): void {
  window.dispatchEvent(new CustomEvent<BridgeNotice>('bridge:notice', {detail: notice}))
}

export function dispatchBridgeRecovered(): void {
  window.dispatchEvent(new CustomEvent('bridge:recovered'))
}
