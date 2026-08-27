import {createServer, request as httpRequest} from 'node:http'
import {request as httpsRequest} from 'node:https'
import {randomBytes} from 'node:crypto'
import {createPinnedLookup, resolveProviderUrl} from '../security/provider-url-security.mjs'
import {createLogger} from '../shared/logger.mjs'
import {fromResponsesJson, toResponsesRequest, translateResponsesSse} from './codex-relay-protocol.mjs'

const log = createLogger('codex-relay-proxy')
const DEFAULT_PORT = 8789
const MAX_REQUEST_BYTES = 10 * 1024 * 1024
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 120_000
const MAX_UPSTREAM_ATTEMPTS = 4
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529])
const RETRYABLE_NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'])
const OVERLOAD_PATTERN = /\b(?:overload(?:ed)?|server(?:s)?\s+(?:are\s+)?busy|capacity|temporar(?:y|ily)\s+unavailable|try\s+again\s+later)\b/i
const TEST_IDLE_DELAY_MAX_MS = 2 * 60 * 1000
let relayRequestCounter = 0

let proxyServer = null
let proxyPort = 0
let startPromise = null
let latestToken = ''
const routesByToken = new Map()
const tokensByConfig = new Map()

function normalizeConfig(config) {
    if (!config || typeof config !== 'object') throw new Error('invalid Codex relay configuration')
    if (typeof config.upstream !== 'string' || !config.upstream.trim()) throw new Error('Codex relay URL is required')
    if (typeof config.apiKey !== 'string' || !config.apiKey || config.apiKey.length > 8192 || /[\0\r\n]/.test(config.apiKey)) throw new Error('Codex relay API key is required')
    const model = typeof config.model === 'string' && config.model.trim() ? config.model.trim() : 'gpt-5.6-sol'
    const port = Number(config.port || process.env.BRIDGE_CODEX_PORT || DEFAULT_PORT)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid Codex relay proxy port')
    return {upstream: config.upstream.trim().replace(/\/+$/, ''), apiKey: config.apiKey, model, port}
}

function configKey(config) {
    return JSON.stringify([config.upstream, config.apiKey, config.model, config.port])
}

function responsesUrl(parsed) {
    const path = (parsed.pathname || '').replace(/\/+$/, '')
    return new URL(`${path.endsWith('/responses') ? path : `${path}/responses`}${parsed.search || ''}`, parsed.origin)
}

async function readRequestBody(req) {
    const chunks = []
    let total = 0
    for await (const chunk of req) {
        total += chunk.length
        if (total > MAX_REQUEST_BYTES) {
            req.resume?.()
            throw Object.assign(new Error('Codex relay request body too large'), {statusCode: 413})
        }
        chunks.push(chunk)
    }
    return Buffer.concat(chunks)
}

async function requestUpstream(target, body, {stream, signal} = {}) {
    const parsed = target.parsed
    const transport = parsed.protocol === 'https:' ? httpsRequest : httpRequest
    const upstream = responsesUrl(parsed)
    const headers = {
        authorization: `Bearer ${target.apiKey}`,
        'content-type': 'application/json',
        accept: stream ? 'text/event-stream' : 'application/json',
        'content-length': Buffer.byteLength(body),
        'accept-encoding': 'identity',
    }
    return await new Promise((resolve, reject) => {
        let settled = false
        const req = transport({
            protocol: upstream.protocol,
            hostname: upstream.hostname,
            port: upstream.port || undefined,
            path: `${upstream.pathname || '/'}${upstream.search || ''}`,
            method: 'POST',
            headers,
            lookup: createPinnedLookup(target.address, target.family),
            servername: upstream.hostname,
            signal,
        }, res => {
            if (settled) return
            settled = true
            resolve({req, res})
        })
        req.on('error', error => {
            if (!settled) { settled = true; reject(error) }
        })
        req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Codex relay request timeout')))
        req.write(body)
        req.end()
    })
}

async function readResponseBody(res) {
    const chunks = []
    let total = 0
    for await (const chunk of res) {
        total += chunk.length
        if (total > MAX_RESPONSE_BYTES) throw Object.assign(new Error('Codex relay response too large'), {statusCode: 502})
        chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
}

function retryAfterMs(headers) {
    const value = String(headers?.['retry-after'] || '').trim()
    if (!value) return null
    if (/^\d+(?:\.\d+)?$/.test(value)) return Math.min(30_000, Math.max(0, Math.round(Number(value) * 1000)))
    const at = Date.parse(value)
    return Number.isFinite(at) ? Math.min(30_000, Math.max(0, at - Date.now())) : null
}

function retryDelayMs(attempt, headers) {
    const instructed = retryAfterMs(headers)
    if (instructed !== null) return instructed
    return Math.min(5_000, 600 * (2 ** Math.max(0, attempt - 1)))
}

function isRetryableUpstreamResponse(statusCode, detail) {
    return RETRYABLE_STATUS_CODES.has(Number(statusCode))
        || (Number(statusCode) === 400 && OVERLOAD_PATTERN.test(String(detail || '')))
}

function isRetryableNetworkError(error) {
    return RETRYABLE_NETWORK_CODES.has(String(error?.code || ''))
        || /(?:timeout|socket hang up|connection reset|temporarily unavailable)/i.test(String(error?.message || ''))
}

function waitForRetry(delayMs, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason || Object.assign(new Error('aborted'), {name: 'AbortError'}))
    return new Promise((resolve, reject) => {
        let timer
        const cleanup = () => signal?.removeEventListener('abort', onAbort)
        const onReady = () => {
            cleanup()
            resolve()
        }
        const onAbort = () => {
            clearTimeout(timer)
            cleanup()
            reject(signal.reason || Object.assign(new Error('aborted'), {name: 'AbortError'}))
        }
        timer = setTimeout(onReady, delayMs)
        signal?.addEventListener('abort', onAbort, {once: true})
    })
}

function controlledIdleDelayMs() {
    if (process.env.BRIDGE_TEST_CODEX_RELAY_FAULTS !== '1') return 0
    const delayMs = Number.parseInt(process.env.BRIDGE_TEST_CODEX_RELAY_IDLE_BEFORE_UPSTREAM_MS || '', 10)
    return Number.isInteger(delayMs) && delayMs > 0 && delayMs <= TEST_IDLE_DELAY_MAX_MS ? delayMs : 0
}

async function injectControlledIdleBeforeUpstream(signal) {
    const delayMs = controlledIdleDelayMs()
    if (!delayMs) return
    // 只由显式测试变量开启；不发送请求到真实上游，供 Gateway watchdog 验收。
    log.warn({delayMs}, 'Codex relay controlled idle fault enabled')
    await waitForRetry(delayMs, signal)
}

function upstreamRequestId(detail, headers) {
    const headerId = headers?.['x-request-id'] || headers?.['request-id']
    if (headerId) return String(headerId).slice(0, 200)
    const match = String(detail || '').match(/request\s*id["'\s:=()-]*([A-Za-z0-9._-]{6,200})/i)
    return match?.[1] || ''
}

function upstreamMessage(detail) {
    const raw = String(detail || '').trim()
    if (!raw) return ''
    try {
        const parsed = JSON.parse(raw)
        const message = parsed?.error?.message || parsed?.message || parsed?.error
        if (typeof message === 'string') return message.slice(0, 500)
    } catch {}
    return raw.replace(/\s+/g, ' ').slice(0, 500)
}

async function requestUpstreamWithRetry(route, body, {stream, signal, requestId} = {}) {
    let lastError = null
    for (let attempt = 1; attempt <= MAX_UPSTREAM_ATTEMPTS; attempt++) {
        try {
            log.info({requestId, attempt, maxAttempts: MAX_UPSTREAM_ATTEMPTS, model: route.model}, 'Codex relay upstream attempt')
            const target = await resolveProviderUrl(route.upstream)
            target.apiKey = route.apiKey
            const upstream = await requestUpstream(target, body, {stream, signal})
            log.info({requestId, attempt, statusCode: upstream.res.statusCode, model: route.model}, 'Codex relay upstream response headers received')
            if (upstream.res.statusCode >= 200 && upstream.res.statusCode < 300) {
                return {upstream, attempts: attempt, detail: ''}
            }

            const detail = (await readResponseBody(upstream.res)).slice(0, 2000)
            const retryable = isRetryableUpstreamResponse(upstream.res.statusCode, detail)
            if (!retryable || attempt >= MAX_UPSTREAM_ATTEMPTS) {
                return {upstream, attempts: attempt, detail, retryable}
            }
            const delayMs = retryDelayMs(attempt, upstream.res.headers)
            log.warn({
                requestId,
                statusCode: upstream.res.statusCode,
                attempt,
                maxAttempts: MAX_UPSTREAM_ATTEMPTS,
                delayMs,
                upstreamRequestId: upstreamRequestId(detail, upstream.res.headers) || undefined,
                model: route.model,
            }, 'Codex relay upstream busy, retrying')
            log.info({requestId, attempt, delayMs, model: route.model}, 'Codex relay retry wait')
            await waitForRetry(delayMs, signal)
        } catch (error) {
            lastError = error
            if (!isRetryableNetworkError(error) || attempt >= MAX_UPSTREAM_ATTEMPTS) {
                error.retryAttempts = attempt
                throw error
            }
            const delayMs = retryDelayMs(attempt)
            log.warn({requestId, err: error, attempt, maxAttempts: MAX_UPSTREAM_ATTEMPTS, delayMs, model: route.model}, 'Codex relay network error, retrying')
            await waitForRetry(delayMs, signal)
        }
    }
    if (lastError) throw lastError
    throw new Error('Codex relay retry loop ended unexpectedly')
}

function detailedUpstreamError(statusCode, detail, attempts, headers) {
    const overloaded = isRetryableUpstreamResponse(statusCode, detail)
    const requestId = upstreamRequestId(detail, headers)
    const message = upstreamMessage(detail)
    const parts = [overloaded
        ? `Codex 中转站持续繁忙，已自动尝试 ${attempts} 次仍未恢复（HTTP ${statusCode}）`
        : `Codex 中转站请求失败（HTTP ${statusCode}，尝试 ${attempts} 次）`]
    if (message) parts.push(`上游信息：${message}`)
    if (requestId && !message.includes(requestId)) parts.push(`request id：${requestId}`)
    if (overloaded) parts.push('建议稍后重试，或临时切换其他模型')
    return parts.join('。')
}

function sendError(res, status, message) {
    if (res.headersSent) { res.destroy(); return }
    res.writeHead(status, {'content-type': 'application/json; charset=utf-8'})
    res.end(JSON.stringify({type: 'error', error: {type: 'api_error', message}}))
}

function modelList(models) {
    return {
        object: 'list',
        data: [...new Set(models)].map(model => ({id: model, object: 'model', owned_by: 'aicodemirror'})),
    }
}

async function handleRequest(req, res) {
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, {'content-type': 'application/json'})
        res.end(JSON.stringify({ok: true, routes: routesByToken.size}))
        return
    }
    if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
        res.writeHead(200, {'content-type': 'application/json'})
        res.end(JSON.stringify(modelList([...routesByToken.values()].map(route => route.model))))
        return
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
        res.writeHead(404, {'content-type': 'application/json'})
        res.end(JSON.stringify({error: {message: 'not found'}}))
        return
    }
    const route = routesByToken.get(requestToken(req))
    if (!route) {
        sendError(res, 401, 'Codex relay local authorization required')
        return
    }
    const abort = new AbortController()
    const requestId = `relay-${Date.now().toString(36)}-${(++relayRequestCounter).toString(36)}`
    const startedAt = Date.now()
    const abortClient = () => abort.abort()
    req.once('aborted', abortClient)
    res.once('close', abortClient)
    try {
        log.info({requestId}, 'Codex relay request started')
        const raw = await readRequestBody(req)
        const body = JSON.parse(raw.toString('utf8'))
        const request = toResponsesRequest(body, route.model)
        await injectControlledIdleBeforeUpstream(abort.signal)
        const result = await requestUpstreamWithRetry(route, JSON.stringify(request), {stream: Boolean(body.stream), signal: abort.signal, requestId})
        const upstream = result.upstream
        if (upstream.res.statusCode < 200 || upstream.res.statusCode >= 300) {
            log.warn({requestId, attempts: result.attempts, statusCode: upstream.res.statusCode, durationMs: Date.now() - startedAt}, 'Codex relay request failed')
            sendError(res, upstream.res.statusCode || 502, detailedUpstreamError(
                upstream.res.statusCode || 502,
                result.detail,
                result.attempts,
                upstream.res.headers,
            ))
            return
        }
        if (body.stream) {
            res.writeHead(200, {'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive'})
            let responseBytes = 0
            const limited = (async function* () {
                for await (const chunk of upstream.res) {
                    responseBytes += chunk.length
                    if (responseBytes > MAX_RESPONSE_BYTES) throw Object.assign(new Error('Codex relay response too large'), {statusCode: 502})
                    yield chunk
                }
            })()
            for await (const frame of translateResponsesSse(limited, body.model || route.model)) res.write(frame)
            if (!res.writableEnded) res.end()
            log.info({requestId, attempts: result.attempts, durationMs: Date.now() - startedAt}, 'Codex relay request completed')
            return
        }
        const response = fromResponsesJson(JSON.parse(await readResponseBody(upstream.res)), body.model || route.model)
        res.writeHead(200, {'content-type': 'application/json; charset=utf-8'})
        res.end(JSON.stringify(response))
        log.info({requestId, attempts: result.attempts, durationMs: Date.now() - startedAt}, 'Codex relay request completed')
    } catch (error) {
        if (error?.name === 'AbortError' || abort.signal.aborted) return
        log.warn({requestId, err: error, statusCode: error?.statusCode, durationMs: Date.now() - startedAt}, 'Codex relay request failed')
        const attempts = Number(error?.retryAttempts || 1)
        const message = attempts > 1
            ? `Codex 中转站网络请求失败，已自动尝试 ${attempts} 次：${String(error?.message || error)}`
            : String(error?.message || error)
        sendError(res, error?.statusCode || (error instanceof SyntaxError ? 400 : 502), message)
    } finally {
        req.removeListener('aborted', abortClient)
        res.removeListener('close', abortClient)
    }
}

function requestToken(req) {
    return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
        || String(req.headers['x-api-key'] || '')
}

export function startCodexRelayProxy(config) {
    const normalized = normalizeConfig(config)
    return (async () => {
        const resolved = await resolveProviderUrl(normalized.upstream)
        if (proxyServer?.listening && proxyPort !== normalized.port) {
            throw new Error(`Codex relay proxy already listens on port ${proxyPort}`)
        }
        if (!proxyServer?.listening) await ensureProxyServer(normalized.port)

        const key = configKey(normalized)
        let token = tokensByConfig.get(key)
        if (!token) {
            token = randomBytes(32).toString('hex')
            tokensByConfig.set(key, token)
            routesByToken.set(token, normalized)
        }
        latestToken = token
        log.info({port: proxyPort, upstream: resolved.parsed.origin, model: normalized.model, routes: routesByToken.size}, 'Codex relay route registered')
        return {server: proxyServer, port: proxyPort, token}
    })()
}

async function ensureProxyServer(port) {
    if (proxyServer?.listening) return
    if (startPromise) {
        await startPromise
        if (proxyPort !== port) throw new Error(`Codex relay proxy already listens on port ${proxyPort}`)
        return
    }
    startPromise = (async () => {
        proxyServer = createServer(handleRequest)
        proxyServer.headersTimeout = 10_000
        proxyServer.requestTimeout = REQUEST_TIMEOUT_MS
        proxyServer.keepAliveTimeout = 5_000
        await new Promise((resolve, reject) => {
            proxyServer.once('error', reject)
            proxyServer.listen(port, '127.0.0.1', resolve)
        }).catch(error => {
            proxyServer = null
            throw error
        })
        proxyPort = port
        log.info({port: proxyPort}, 'Codex relay proxy started')
    })().finally(() => { startPromise = null })
    await startPromise
}

export function getCodexRelayProxyUrl() {
    return proxyPort ? `http://127.0.0.1:${proxyPort}` : ''
}

export function getCodexRelayProxyToken() {
    return latestToken
}

export function isCodexRelayProxyConfiguredFor(config) {
    try { return tokensByConfig.has(configKey(normalizeConfig(config))) && Boolean(proxyServer?.listening) } catch (error) { return false }
}

export async function stopCodexRelayProxy() {
    const server = proxyServer
    proxyServer = null
    proxyPort = 0
    latestToken = ''
    routesByToken.clear()
    tokensByConfig.clear()
    if (!server) return
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(() => resolve()))
}
