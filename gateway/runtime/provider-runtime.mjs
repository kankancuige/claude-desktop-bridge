import {request as httpRequest} from 'node:http'
import {request as httpsRequest} from 'node:https'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {startDeepSeekProxy, getProxyUrl, stopDeepSeekProxy, isProxyConfiguredFor} from '../providers/deepseek-proxy.mjs'
import {startOpenCodeProxy, getOpenCodeProxyUrl, stopOpenCodeProxy, isOpenCodeProxyRunning} from '../providers/opencode-proxy.mjs'
import {getCodexRelayProxyUrl, startCodexRelayProxy, stopCodexRelayProxy} from '../providers/codex-relay-proxy.mjs'
import {resolveProviderUrl, resolveProviderRedirect, createPinnedLookup} from '../security/provider-url-security.mjs'
import {normalizeBridgeProviderSettings, overlayBridgeProviderSettings} from '../providers/bridge-provider-settings.mjs'

/**
 * 供应商边界运行时：集中管理配置、出口安全和本地协议代理。
 * 组合根只负责把它接到 HTTP 路由和 SDK Query 选项，不直接持有代理状态。
 */
export function createProviderRuntime({
    bridgeHome,
    model = process.env.ANTHROPIC_MODEL || 'deepseek-v4-pro',
    providerSettingsPath = join(bridgeHome, 'bridge-provider.json'),
    settingsPath = join(bridgeHome, 'settings.json'),
    env = process.env,
    readJSON = path => {
        try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
    },
    writeJSON = (path, value) => {
        const tempPath = `${path}.tmp`
        const json = JSON.stringify(value, null, 2)
        mkdirSync(dirname(path), {recursive: true})
        writeFileSync(tempPath, json, {encoding: 'utf8', mode: 0o600})
        writeFileSync(path, json, {encoding: 'utf8', mode: 0o600})
    },
    logger = {debug() {}, warn() {}, error() {}, info() {}},
    httpRequestImpl = httpRequest,
    httpsRequestImpl = httpsRequest,
    proxy = {
        startDeepSeekProxy,
        getProxyUrl,
        stopDeepSeekProxy,
        isProxyConfiguredFor,
        startOpenCodeProxy,
        getOpenCodeProxyUrl,
        stopOpenCodeProxy,
        isOpenCodeProxyRunning,
        getCodexRelayProxyUrl,
        startCodexRelayProxy,
        stopCodexRelayProxy,
    },
} = {}) {
    if (!bridgeHome || typeof bridgeHome !== 'string') throw new TypeError('bridgeHome is required')

    let deepSeekStarting = null
    let openCodeStarting = null

    function loadBridgeProviderSettings() {
        const stored = readJSON(providerSettingsPath)
        if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
            return normalizeBridgeProviderSettings(stored)
        }
        return normalizeBridgeProviderSettings({
            model: env.ANTHROPIC_MODEL || model,
            env: {
                ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL || 'https://api.deepseek.com/anthropic',
                ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY,
            },
        })
    }

    function saveBridgeProviderSettings(settings) {
        const normalized = normalizeBridgeProviderSettings(settings)
        mkdirSync(bridgeHome, {recursive: true})
        writeJSON(providerSettingsPath, normalized)
        return normalized
    }

    function loadCliSettings() {
        const raw = readJSON(settingsPath) || {}
        return overlayBridgeProviderSettings(raw, loadBridgeProviderSettings())
    }

    function loadCliSettingsForUpdate() {
        if (!existsSync(settingsPath)) return {}
        const value = JSON.parse(readFileSync(settingsPath, 'utf8'))
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('settings.json 内容无效，已拒绝覆盖原文件')
        }
        return value
    }

    function requestPinnedProvider(target, options = {}) {
        const {parsed, address, family} = target
        const transport = parsed.protocol === 'https:' ? httpsRequestImpl : httpRequestImpl
        const requestHeaders = new Headers(options.headers || {})
        requestHeaders.set('host', parsed.host)
        const requestOptions = {
            protocol: parsed.protocol,
            hostname: parsed.hostname.replace(/^\[|\]$/g, ''),
            port: parsed.port || undefined,
            path: `${parsed.pathname || '/'}${parsed.search || ''}`,
            method: options.method || 'GET',
            headers: Object.fromEntries(requestHeaders.entries()),
            lookup: createPinnedLookup(address, family),
            signal: options.signal,
            ...(parsed.protocol === 'https:' ? {servername: parsed.hostname.replace(/^\[|\]$/g, '')} : {}),
        }
        return new Promise((resolve, reject) => {
            const maxResponseBytes = 5 * 1024 * 1024
            let settled = false
            const req = transport(requestOptions, response => {
                const chunks = []
                let totalBytes = 0
                response.on('data', chunk => {
                    if (settled) return
                    totalBytes += chunk.length
                    if (totalBytes > maxResponseBytes) {
                        settled = true
                        response.destroy()
                        req.destroy()
                        reject(new Error('provider response too large'))
                        return
                    }
                    chunks.push(chunk)
                })
                response.on('end', () => {
                    if (settled) return
                    settled = true
                    const headers = new Headers()
                    for (const [key, value] of Object.entries(response.headers)) {
                        if (Array.isArray(value)) value.forEach(item => headers.append(key, item))
                        else if (value != null) headers.set(key, String(value))
                    }
                    resolve(new Response(Buffer.concat(chunks), {
                        status: response.statusCode || 502,
                        statusText: response.statusMessage || '',
                        headers,
                    }))
                })
                response.on('error', error => {
                    if (settled) return
                    settled = true
                    reject(error)
                })
            })
            req.on('error', error => {
                if (settled) return
                settled = true
                reject(error)
            })
            if (options.body != null) req.write(options.body)
            req.end()
        })
    }

    async function fetchProviderResponse(rawUrl, options = {}) {
        let currentUrl = rawUrl
        const allowedOrigin = new URL(rawUrl).origin
        for (let hop = 0; hop < 4; hop++) {
            const target = await resolveProviderUrl(currentUrl)
            const response = await requestPinnedProvider(target, options)
            if (response.status < 300 || response.status >= 400) return {response, url: currentUrl}
            const location = response.headers.get('location')
            if (!location) return {response, url: currentUrl}
            currentUrl = resolveProviderRedirect(currentUrl, location, allowedOrigin)
        }
        throw new Error('provider redirect limit exceeded')
    }

    async function prepareQueryProvider({baseUrl, apiKey, model: resolvedModel, deferAutomaticQuery = false} = {}) {
        const usesDeepSeek = typeof baseUrl === 'string' && /deepseek/i.test(baseUrl)
        const usesCodexRelay = typeof baseUrl === 'string' && /\/api\/codex\/backend-api\/codex(?:\/|$)/i.test(baseUrl)
        let deepSeekProxyReady = false
        if (usesDeepSeek) {
            if (!deepSeekStarting) deepSeekStarting = proxy.startDeepSeekProxy(baseUrl).finally(() => { deepSeekStarting = null })
            try {
                await deepSeekStarting
                deepSeekProxyReady = proxy.isProxyConfiguredFor(baseUrl)
            } catch (error) {
                logger.error({err: error}, 'DeepSeek proxy 启动失败')
            }
        }
        if (baseUrl && baseUrl.includes('opencode') && !proxy.isOpenCodeProxyRunning()) {
            if (!openCodeStarting) openCodeStarting = proxy.startOpenCodeProxy().finally(() => { openCodeStarting = null })
            try { await openCodeStarting } catch (error) { logger.error({err: error}, 'OpenCode proxy 启动失败') }
        }
        let effectiveBaseUrl = deepSeekProxyReady ? proxy.getProxyUrl()
            : (baseUrl && baseUrl.includes('opencode') && proxy.isOpenCodeProxyRunning()) ? proxy.getOpenCodeProxyUrl()
                : baseUrl
        let sdkApiKey = apiKey
        if (usesCodexRelay && !deferAutomaticQuery) {
            try {
                const relay = await proxy.startCodexRelayProxy({upstream: baseUrl, apiKey, model: resolvedModel})
                effectiveBaseUrl = proxy.getCodexRelayProxyUrl()
                sdkApiKey = relay.token
            } catch (error) {
                logger.error({err: error}, 'Codex Relay 代理启动失败')
                throw new Error(`Codex Relay 代理启动失败: ${error?.message || error}`)
            }
        }
        return {effectiveBaseUrl, sdkApiKey, usesDeepSeek, usesCodexRelay}
    }

    function stopProxies() {
        return [
            ['DeepSeek proxy', proxy.stopDeepSeekProxy],
            ['OpenCode proxy', proxy.stopOpenCodeProxy],
            ['Codex Relay proxy', proxy.stopCodexRelayProxy],
        ]
    }

    function startBootProxies() {
        return {
            deepSeek: proxy.startDeepSeekProxy('https://api.deepseek.com/anthropic'),
            openCode: proxy.startOpenCodeProxy(),
        }
    }

    return {
        loadBridgeProviderSettings,
        saveBridgeProviderSettings,
        loadCliSettings,
        loadCliSettingsForUpdate,
        requestPinnedProvider,
        fetchProviderResponse,
        prepareQueryProvider,
        stopProxies,
        startBootProxies,
    }
}
