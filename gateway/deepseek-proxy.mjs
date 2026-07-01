/**
 * deepseek-proxy.mjs — Gateway 内置 DeepSeek 兼容代理
 *
 * 修复两个 Claude Code ↔ DeepSeek API 兼容性 Bug:
 *   Bug A: thinking:disabled + reasoning_effort 互斥 → 剥离 thinking 字段
 *   Bug B: reasoning_content 丢失 → 缓存 + 回注
 *
 * 架构: claude.exe → 127.0.0.1:{port} → 本代理 → api.deepseek.com/anthropic
 * 仅在 ANTHROPIC_BASE_URL 包含 "deepseek" 时启用
 */

// https://github.com/kankancuige/claude-desktop-bridge
import {createServer as createHttpServer} from 'node:http'
import {request as httpsRequest} from 'node:https'
import {createHash} from 'node:crypto'
import {createLogger} from './logger.mjs'

const log = createLogger('proxy')

let proxyPort = 0
let proxyServer = null
let _startPromise = null

// ── thinking 块缓存 (fingerprint → [{index, thinking, signature}]) ──
const thinkingCache = new Map()
const MAX_CACHE_PER_SESSION = 50
/** 全局 session 数量上限，超限时淘汰最旧条目，防止长时间运行 OOM */
const MAX_CACHE_SESSIONS = 500
const CACHE_TTL_MS = 30 * 60 * 1000
let _cacheCleanupTimer = setInterval(() => {
    const cutoff = Date.now() - CACHE_TTL_MS
    for (const [k, v] of thinkingCache) {
        const lastCached = v[v.length - 1]?.cachedAt || 0
        if (lastCached < cutoff) thinkingCache.delete(k)
    }
    // 超 session 上限时按最后活跃时间淘汰最旧的
    while (thinkingCache.size > MAX_CACHE_SESSIONS) {
        let oldest = null
        for (const [k, v] of thinkingCache) {
            const ts = v[v.length - 1]?.cachedAt || 0
            if (!oldest || ts < oldest.ts) oldest = {key: k, ts}
        }
        if (oldest) thinkingCache.delete(oldest.key)
        else break
    }
}, CACHE_TTL_MS)
if (_cacheCleanupTimer.unref) _cacheCleanupTimer.unref()

// ── 从请求体提取会话指纹，不同对话自动隔离 thinking 缓存 ──
function getSessionFingerprint(body) {
    if (!body || !body.messages) return 'default'
    const model = body.model || 'default'
    // 用第一条 user 消息内容 + 消息总数做 fingerprint
    // SHA256 取 16 位 hex，碰撞空间 2^64，比 8 位 MD5 (2^32) 安全得多
    const firstUser = body.messages.find(m => m.role === 'user')
    if (firstUser) {
        const content = typeof firstUser.content === 'string'
            ? firstUser.content
            : (Array.isArray(firstUser.content)
                ? firstUser.content.filter(b => b.type === 'text').map(b => b.text).join('')
                : '')
        if (content) {
            const h = createHash('sha256')
                .update(content.slice(0, 500))
                .update(String(body.messages.length))
                .digest('hex').slice(0, 16)
            return model + '-' + h
        }
    }
    return model
}

/**
 * 启动代理服务器
 * @param {string} upstream - 上游 DeepSeek API 地址
 * @returns {Promise<{server, port}>}
 */
export function startDeepSeekProxy(upstream) {
    if (_startPromise) return _startPromise
    _startPromise = new Promise((resolve, reject) => {
        if (proxyServer) {
            resolve({server: proxyServer, port: proxyPort})
            return
        }

        const upstreamUrl = new URL(upstream)
        proxyServer = createHttpServer((req, res) => {
            handleProxyRequest(req, res, upstreamUrl)
        })

        // 固定端口 8787，供 Claude Desktop settings.json 配置引用
        const TRY_PORT = 8787
        proxyServer.on('error', (e) => {
            if (e.code === 'EADDRINUSE') {
                // 固定端口被占 → 直接报错，不静默回退随机端口
                // 回退随机端口会让 settings.json 里写死的 8787 静态引用失效（脱离 gateway 直跑 CLI 时连不上）
                proxyServer = null
                _startPromise = null
                reject(new Error('端口 8787 被占用，DeepSeek 代理无法启动。请关闭占用 8787 的进程后重启。'))
            } else {
                log.error({err: e}, '代理服务异常')
                proxyServer = null
                _startPromise = null
                reject(e)
            }
        })
        proxyServer.listen(TRY_PORT, '127.0.0.1', () => {
            proxyPort = TRY_PORT
            log.info({port: proxyPort, upstream}, '代理已启动')
            resolve({server: proxyServer, port: proxyPort})
        })
    })
    return _startPromise
}

export function getProxyPort() {
    return proxyPort
}

export function getProxyUrl() {
    return `http://127.0.0.1:${proxyPort}`
}

export function isProxyRunning() {
    return proxyServer !== null && proxyServer.listening
}

/** 停止代理 (进程退出时调用)，同时清理缓存定时器 */
export function stopDeepSeekProxy() {
    if (_cacheCleanupTimer) {
        clearInterval(_cacheCleanupTimer)
        _cacheCleanupTimer = null
    }
    // 重置 _startPromise：否则 stop 后再 start 会返回旧的 resolved promise（指向已 close 的 server），代理无法重启
    _startPromise = null
    if (proxyServer) {
        try {
            proxyServer.closeAllConnections?.()
            proxyServer.close()
            setTimeout(() => { proxyServer?.unref() }, 2000)
        } catch {
        }
        proxyServer = null
        proxyPort = 0
    }
}

// ══════════════════════════════════════════════════════
// ── 请求处理核心 ──
// ══════════════════════════════════════════════════════

async function handleProxyRequest(clientReq, clientRes, upstreamUrl) {
    try {
        // ── 1. 读取完整请求体 ──
        const chunks = []
        for await (const chunk of clientReq) {
            chunks.push(chunk)
        }
        const rawBody = Buffer.concat(chunks).toString('utf8')

        let body
        try {
            body = JSON.parse(rawBody)
        } catch {
            body = null
        }

        // ── 2. 健康检查端点 ──
        if (clientReq.url === '/health' && clientReq.method === 'GET') {
            clientRes.writeHead(200, {'Content-Type': 'application/json'})
            clientRes.end(JSON.stringify({
                status: 'ok',
                upstream: upstreamUrl.href,
                cacheSessions: thinkingCache.size,
            }))
            return
        }

        // ── 2b. GET /v1/models —— Claude Code 启动时校验模型名，DeepSeek 不实现此端点需伪造 ──
        if (clientReq.method === 'GET' && (clientReq.url === '/v1/models' || clientReq.url === '/v1/models?before=undefined')) {
            clientRes.writeHead(200, {'Content-Type': 'application/json'})
            clientRes.end(JSON.stringify({
                data: [
                    {
                        id: 'deepseek-v4-pro',
                        type: 'model',
                        display_name: 'DeepSeek V4 Pro',
                        created_at: '2026-04-24T00:00:00Z'
                    },
                    {
                        id: 'deepseek-v4-pro[1M]',
                        type: 'model',
                        display_name: 'DeepSeek V4 Pro (1M)',
                        created_at: '2026-04-24T00:00:00Z'
                    },
                    {
                        id: 'deepseek-v4-flash',
                        type: 'model',
                        display_name: 'DeepSeek V4 Flash',
                        created_at: '2026-04-24T00:00:00Z'
                    },
                    {
                        id: 'deepseek-v4-flash[1M]',
                        type: 'model',
                        display_name: 'DeepSeek V4 Flash (1M)',
                        created_at: '2026-04-24T00:00:00Z'
                    },
                    {
                        id: 'deepseek-chat',
                        type: 'model',
                        display_name: 'DeepSeek Chat',
                        created_at: '2025-01-01T00:00:00Z'
                    },
                    {
                        id: 'deepseek-reasoner',
                        type: 'model',
                        display_name: 'DeepSeek Reasoner',
                        created_at: '2025-01-01T00:00:00Z'
                    },
                    {
                        id: 'claude-opus-4-5',
                        type: 'model',
                        display_name: 'Claude Opus 4.5',
                        created_at: '2025-11-01T00:00:00Z'
                    },
                    {
                        id: 'claude-sonnet-4-5',
                        type: 'model',
                        display_name: 'Claude Sonnet 4.5',
                        created_at: '2025-09-29T00:00:00Z'
                    },
                    {
                        id: 'claude-haiku-4-5',
                        type: 'model',
                        display_name: 'Claude Haiku 4.5',
                        created_at: '2025-10-01T00:00:00Z'
                    },
                    {
                        id: 'claude-opus-4',
                        type: 'model',
                        display_name: 'Claude Opus 4',
                        created_at: '2025-05-14T00:00:00Z'
                    },
                    {
                        id: 'claude-sonnet-4',
                        type: 'model',
                        display_name: 'Claude Sonnet 4',
                        created_at: '2025-05-14T00:00:00Z'
                    },
                ]
            }))
            return
        }

        // ── 3. 综合修复 ──
        const sessionFp = body ? getSessionFingerprint(body) : 'default'
        if (body) {
            body = applyAllFixes(body, sessionFp)
        }

        const modifiedBody = body ? JSON.stringify(body) : rawBody

        // ── 5. 构建上游请求 headers ──
        const upstreamHeaders = {...clientReq.headers}
        delete upstreamHeaders.host
        upstreamHeaders['content-length'] = Buffer.byteLength(modifiedBody)

        // 拼接上游 base path（如 /anthropic）+ 客户端请求路径
        const upstreamPath = (upstreamUrl.pathname || '').replace(/\/+$/, '') + clientReq.url

        const proxyReq = httpsRequest({
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port || 443,
            path: upstreamPath,
            method: clientReq.method,
            headers: upstreamHeaders,
        }, (upstreamRes) => {
            // ── 6. Bug B: 缓存响应中的 thinking 块 ──
            const responseChunks = []
            upstreamRes.on('data', (chunk) => responseChunks.push(chunk))
            upstreamRes.on('end', () => {
                const responseBody = Buffer.concat(responseChunks).toString('utf8')
                cacheResponseThinking(sessionFp, responseBody)

                // 透传响应
                clientRes.writeHead(upstreamRes.statusCode, upstreamRes.headers)
                clientRes.end(responseBody)
            })
        })

        proxyReq.on('error', (e) => {
            log.error({err: e}, '上游请求失败')
            if (!clientRes.headersSent) {
                clientRes.writeHead(502)
                clientRes.end(JSON.stringify({error: 'proxy_upstream_error', message: e.message}))
            }
        })

        proxyReq.write(modifiedBody)
        proxyReq.end()

    } catch (e) {
        log.error({err: e}, '代理处理器异常')
        if (!clientRes.headersSent) {
            clientRes.writeHead(500)
            clientRes.end(JSON.stringify({error: 'proxy_internal_error', message: e.message}))
        }
    }
}

// ══════════════════════════════════════════════════════
// ── Bug A: thinking:disabled 剥离 ──
// ══════════════════════════════════════════════════════

function fixThinkingDisabled(body) {
    if (!body || typeof body !== 'object') return body

    // 顶层 thinking: disabled
    if (body.thinking?.type === 'disabled') {
        const hasReasoning = body.output_config?.effort || body.reasoning_effort
        if (hasReasoning) {
            delete body.thinking
        }
    }

    return body
}

// ══════════════════════════════════════════════════════
// ── 综合修复入口 ──
// ══════════════════════════════════════════════════════

function applyAllFixes(body, sessionFp) {
    body = fixThinkingDisabled(body)
    body = injectThinkingBlocks(body, sessionFp)
    return body
}

// ══════════════════════════════════════════════════════
// ── Bug B: reasoning_content 缓存与回注 ──
// ══════════════════════════════════════════════════════

/**
 * 从 DeepSeek 响应中提取 reasoning_content 并缓存
 * 支持两种格式:
 *   Anthropic: content[].thinking 块
 *   OpenAI:    reasoning_content 字段
 */
function cacheResponseThinking(fingerprint, responseBody) {
    try {
        const data = JSON.parse(responseBody)

        // Anthropic 格式: content 数组中有 thinking 类型的块
        if (data.content && Array.isArray(data.content)) {
            const thinkingBlocks = data.content.filter(b => b.type === 'thinking')
            if (thinkingBlocks.length > 0) {
                if (!thinkingCache.has(fingerprint)) {
                    thinkingCache.set(fingerprint, [])
                }
                const cache = thinkingCache.get(fingerprint)
                for (const tb of thinkingBlocks) {
                    cache.push({
                        thinking: tb.thinking || '',
                        signature: tb.signature || '',
                        cachedAt: Date.now(),
                    })
                    while (cache.length > MAX_CACHE_PER_SESSION) cache.shift()
                }
            }
        }

        // OpenAI 格式: reasoning_content 字段
        if (data.choices && Array.isArray(data.choices)) {
            for (const choice of data.choices) {
                if (choice.message?.reasoning_content) {
                    if (!thinkingCache.has(fingerprint)) {
                        thinkingCache.set(fingerprint, [])
                    }
                    thinkingCache.get(fingerprint).push({
                        thinking: choice.message.reasoning_content,
                        signature: '',
                        cachedAt: Date.now(),
                    })
                }
            }
        }
    } catch {
        // 响应非 JSON（HTTP 错误页等），正常跳过，不影响主响应透传
        log.debug({fingerprint, len: (responseBody || '').length}, 'thinking 缓存: 响应非 JSON，跳过')
    }
}

/**
 * 向请求的 messages 中注入缺失的 reasoning_content
 * 遍历 assistant 消息: 有 tool_calls 但缺 thinking 块 → 从缓存注入
 */
function injectThinkingBlocks(body, fingerprint) {
    if (!body.messages || !Array.isArray(body.messages)) return body

    const cache = thinkingCache.get(fingerprint)
    if (!cache || cache.length === 0) return body

    let cacheIdx = 0
    const newMessages = body.messages.map((msg) => {
        if (msg.role !== 'assistant') return msg

        const hasToolUse = (Array.isArray(msg.content) && msg.content.some(b => b.type === 'tool_use'))
            || msg.tool_calls?.length > 0

        if (!hasToolUse) return msg

        // Anthropic 格式
        if (Array.isArray(msg.content)) {
            const hasThinking = msg.content.some(b => b.type === 'thinking')
            if (!hasThinking && cacheIdx < cache.length) {
                const cached = cache[cacheIdx++]
                const thinkingBlock = {type: 'thinking', thinking: cached.thinking}
                if (cached.signature) thinkingBlock.signature = cached.signature
                // thinking 块插入到 tool_use 之前
                const toolIdx = msg.content.findIndex(b => b.type === 'tool_use')
                if (toolIdx >= 0) {
                    const newContent = [...msg.content]
                    newContent.splice(toolIdx, 0, thinkingBlock)
                    return {...msg, content: newContent}
                }
            }
        }

        // OpenAI 格式
        if (msg.tool_calls?.length > 0 && !msg.reasoning_content && cacheIdx < cache.length) {
            const cached = cache[cacheIdx++]
            return {...msg, reasoning_content: cached.thinking}
        }

        return msg
    })

    return {...body, messages: newMessages}
}
