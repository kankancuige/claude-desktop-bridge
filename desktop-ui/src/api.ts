import {
  classifyBridgeFailure,
  dispatchBridgeNotice,
  dispatchBridgeRecovered,
  shouldNotifyHttpStatus,
} from './bridge-errors'

/**
 * 共享 API 认证层: 自动附加 bridge-token 认证头
 * 桌面端从 Electron main process 读取 token，浏览器环境从 gateway 获取
 *
 * 通过全局 fetch 拦截器实现: 所有到 127.0.0.1:3456 的 POST/PUT/DELETE 请求自动注入 token。
 * 无需逐个修改已有的 fetch 调用点。
 */
let _token: string | null = null
let _tokenPromise: Promise<string | null> | null = null
let _tokenGeneration = 0
const DEFAULT_GATEWAY_TIMEOUT_MS = 60_000
const LONG_GATEWAY_TIMEOUT_MS = 180_000
const LONG_GATEWAY_PATHS = new Set([
  '/api/config/caveman/update',
  '/api/config/rtk/update',
  '/api/config/skills-market/install',
])
const noticeLastSeen = new Map<string, number>()
let transportFailureActive = false

function requestPath(url: URL): string {
  return `${url.pathname}${url.search}`
}

function notifyFailure(input: Parameters<typeof classifyBridgeFailure>[0]): void {
  const notice = classifyBridgeFailure(input)
  const now = Date.now()
  const previous = noticeLastSeen.get(notice.dedupeKey) || 0
  if (now - previous < 8_000) return
  noticeLastSeen.set(notice.dedupeKey, now)
  dispatchBridgeNotice(notice)
  if (notice.code === 'GATEWAY_UNAVAILABLE' || notice.code === 'GATEWAY_TIMEOUT') {
    transportFailureActive = true
  }
}

async function notifyHttpFailure(response: Response, path: string): Promise<void> {
  if (!shouldNotifyHttpStatus(response.status)) return
  let serverCode: string | undefined
  let serverMessage: string | undefined
  try {
    const body = await response.clone().json()
    if (body && typeof body === 'object') {
      serverCode = typeof body.code === 'string' ? body.code : undefined
      serverMessage = typeof body.error === 'string'
        ? body.error
        : typeof body.message === 'string' ? body.message : undefined
    }
  } catch {
    // 错误体不是 JSON 时使用 HTTP 状态分类，不能影响原始响应消费。
  }
  notifyFailure({status: response.status, path, serverCode, serverMessage})
}

function notifyGatewayRecovered(): void {
  if (!transportFailureActive) return
  transportFailureActive = false
  dispatchBridgeRecovered()
}

/** Gateway 重启会轮换 token；WebSocket 收到 4003 时显式清除本地缓存。 */
export function invalidateBridgeToken() {
  _tokenGeneration++
  _token = null
  _tokenPromise = null
}

async function resolveToken(forceRefresh = false): Promise<string | null> {
  if (forceRefresh) invalidateBridgeToken()
  if (_token !== null) return _token || null
  if (_tokenPromise) return _tokenPromise

  const generation = _tokenGeneration
  const pending = (async () => {
    let resolved: string | null = null
    try {
      const w = window as any
      if (w.electronAPI?.getBridgeToken) {
        resolved = await w.electronAPI.getBridgeToken()
      } else if (import.meta.env.DEV) {
        // 浏览器开发模式还需在 Gateway 显式设置 BRIDGE_ALLOW_TOKEN_ENDPOINT=1。
        const r = await fetch('http://127.0.0.1:3456/api/bridge-token', {signal: AbortSignal.timeout(10_000)})
        if (r.ok) {
          const d = await r.json()
          resolved = d.token || null
        }
      }
    } catch {
      resolved = null
    }
    // 刷新期间若再次失效，不允许较早的异步读取覆盖新 token。
    if (_tokenGeneration === generation) _token = resolved
    return resolved
  })()
  _tokenPromise = pending
  try {
    return await pending
  } finally {
    if (_tokenPromise === pending) _tokenPromise = null
  }
}

function parseGatewayUrl(input: RequestInfo | URL): URL | null {
  try {
    const raw = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString())
    const parsed = new URL(raw, window.location.href)
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port === '3456'
      ? parsed
      : null
  } catch {
    return null
  }
}

// ── 全局 fetch 拦截器: 对 gateway 所有请求自动注入 token ──
// GET 也注入: gateway 已对敏感 GET API 加 token 校验（防跨域恶意网页读本地 API）
// 唯一豁免 /api/bridge-token: 取 token 前还没有 token, 不能注
const _origFetch = window.fetch.bind(window)

function gatewayRequestWithTimeout(request: Request, gatewayUrl: URL): Request {
  const timeoutMs = LONG_GATEWAY_PATHS.has(gatewayUrl.pathname)
    ? LONG_GATEWAY_TIMEOUT_MS
    : DEFAULT_GATEWAY_TIMEOUT_MS
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = typeof AbortSignal.any === 'function'
    ? AbortSignal.any([request.signal, timeoutSignal])
    : timeoutSignal
  return new Request(request, {signal})
}

window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
  const gatewayUrl = parseGatewayUrl(input)

  if (gatewayUrl && gatewayUrl.pathname !== '/api/bridge-token') {
    const token = await resolveToken()
    const request = gatewayRequestWithTimeout(new Request(input, init), gatewayUrl)
    try {
      const retryRequest = request.clone()
      const headers = new Headers(request.headers)
      if (token && !headers.has('x-bridge-token')) {
        headers.set('x-bridge-token', token)
      }
      let response = await _origFetch(new Request(request, {headers}))
      if (response.status === 403) {
        const refreshedToken = await resolveToken(true)
        if (refreshedToken && refreshedToken !== token) {
          headers.set('x-bridge-token', refreshedToken)
          response = await _origFetch(new Request(retryRequest, {headers}))
        }
      }
      if (response.ok) notifyGatewayRecovered()
      else void notifyHttpFailure(response, requestPath(gatewayUrl))
      return response
    } catch (error) {
      notifyFailure({error, path: requestPath(gatewayUrl)})
      throw error
    }
  }
  return _origFetch(input, init)
}

export async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  return fetch(url, options)
}

/** WebSocket 连接：固定子协议携带认证信息，避免 token 出现在 URL 和访问日志。 */
export async function createGatewayWebSocket(path: string, forceRefresh = false): Promise<WebSocket> {
  const token = await resolveToken(forceRefresh)
  const protocols = token ? ['claude-bridge-v1', `claude-bridge-auth.${token}`] : []
  return protocols.length
    ? new WebSocket(`ws://127.0.0.1:3456${path}`, protocols)
    : new WebSocket(`ws://127.0.0.1:3456${path}`)
}
