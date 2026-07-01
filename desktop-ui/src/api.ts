/**
 * 共享 API 认证层: 自动附加 bridge-token 认证头
 * 桌面端从 Electron main process 读取 token，浏览器环境从 gateway 获取
 *
 * 通过全局 fetch 拦截器实现: 所有到 127.0.0.1:3456 的 POST/PUT/DELETE 请求自动注入 token。
 * 无需逐个修改已有的 fetch 调用点。
 */
let _token: string | null = null
let _tokenPromise: Promise<string | null> | null = null

async function resolveToken(): Promise<string | null> {
  if (_token !== null) return _token || null
  if (_tokenPromise) return _tokenPromise

  _tokenPromise = (async () => {
    try {
      const w = window as any
      if (w.electronAPI?.getBridgeToken) {
        _token = await w.electronAPI.getBridgeToken()
      } else {
        // 浏览器/dev 环境 fallback: fetch token from gateway（127.0.0.1 无外部风险）
        const r = await fetch('http://127.0.0.1:3456/api/bridge-token')
        if (r.ok) {
          const d = await r.json()
          _token = d.token || null
        }
      }
    } catch {
      _token = null
    }
    return _token
  })()

  return _tokenPromise
}

// ── 全局 fetch 拦截器: 对 gateway POST/PUT/DELETE 请求自动注入 token ──
const _origFetch = window.fetch.bind(window)
window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString())
  const method = (init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase()

  if (url.includes('127.0.0.1:3456') && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
    const token = await resolveToken()
    if (token) {
      const headers = new Headers(init?.headers)
      if (!headers.has('x-bridge-token')) {
        headers.set('x-bridge-token', token)
      }
      return _origFetch(input, { ...init, headers })
    }
  }
  return _origFetch(input, init)
}

export async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  return fetch(url, options)
}

/** WebSocket 连接 URL 构建: 自动附加 token 查询参数 */
export async function wsUrl(path: string): Promise<string> {
  const token = await resolveToken()
  const sep = path.includes('?') ? '&' : '?'
  return token ? `ws://127.0.0.1:3456${path}${sep}token=${encodeURIComponent(token)}` : `ws://127.0.0.1:3456${path}`
}
