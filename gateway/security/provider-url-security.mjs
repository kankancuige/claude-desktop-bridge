import dns from 'node:dns/promises'
import {isIP} from 'node:net'

const MAX_PROVIDER_URL_LENGTH = 2048
const LOCAL_PROVIDER_FLAG = 'BRIDGE_ALLOW_LOCAL_PROVIDER'

function ipv4ToInt(value) {
    const parts = value.split('.').map(Number)
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
    return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0
}

function inIpv4Range(value, start, end) {
    const ip = ipv4ToInt(value)
    const low = ipv4ToInt(start)
    const high = ipv4ToInt(end)
    return ip !== null && low !== null && high !== null && ip >= low && ip <= high
}

function expandIpv6(value) {
    const input = value.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
    const hasCompression = input.includes('::')
    const [head, tail, extra] = input.split('::')
    if (extra !== undefined) return null
    const parsePart = (part) => {
        if (!part) return []
        if (part.includes('.')) {
            const ip = ipv4ToInt(part)
            return ip === null ? null : [(ip >>> 16) & 0xffff, ip & 0xffff]
        }
        const parts = part.split(':')
        return parts.every((item) => /^[0-9a-f]{1,4}$/.test(item)) ? parts.map((item) => parseInt(item, 16)) : null
    }
    const left = parsePart(head)
    const right = parsePart(tail)
    if (!left || !right) return null
    const missing = 8 - left.length - right.length
    if (missing < 0 || (missing === 0 && hasCompression)) return null
    return [...left, ...Array(missing).fill(0), ...right]
}

function isPrivateAddress(address) {
    const version = isIP(address)
    if (version === 4) {
        return inIpv4Range(address, '0.0.0.0', '0.255.255.255')
            || inIpv4Range(address, '10.0.0.0', '10.255.255.255')
            || inIpv4Range(address, '100.64.0.0', '100.127.255.255')
            || inIpv4Range(address, '127.0.0.0', '127.255.255.255')
            || inIpv4Range(address, '169.254.0.0', '169.254.255.255')
            || inIpv4Range(address, '172.16.0.0', '172.31.255.255')
            || inIpv4Range(address, '192.0.0.0', '192.0.0.255')
            || inIpv4Range(address, '192.168.0.0', '192.168.255.255')
            || inIpv4Range(address, '198.18.0.0', '198.19.255.255')
            || inIpv4Range(address, '224.0.0.0', '255.255.255.255')
    }
    if (version === 6) {
        const parts = expandIpv6(address)
        if (!parts) return true
        const mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff
        if (mapped) return isPrivateAddress(`${parts[6] >> 8}.${parts[6] & 255}.${parts[7] >> 8}.${parts[7] & 255}`)
        const first = parts[0]
        return parts.every((part) => part === 0)
            || (parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1)
            || (first & 0xfe00) === 0xfc00
            || (first & 0xffc0) === 0xfe80
            || (first & 0xff00) === 0xff00
    }
    return false
}

function localProviderAllowed() {
    return process.env[LOCAL_PROVIDER_FLAG] === '1'
}

function isLocalHost(hostname) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return host === 'localhost' || host.endsWith('.localhost') || isPrivateAddress(host)
}

function isTrustedOllamaUrl(parsed) {
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
    return ['localhost', '127.0.0.1', '::1'].includes(host)
        && port === '11434' && /^\/v1(?:\/|$)/i.test(parsed.pathname)
}

/**
 * 校验供应商探测 URL。默认只允许解析到公网地址，本机 Ollama 等服务需显式开启开发开关。
 */
async function resolveProviderTarget(raw, {allowLocal = localProviderAllowed()} = {}) {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_PROVIDER_URL_LENGTH || raw.includes('\0')) {
        throw new Error('invalid provider URL')
    }
    let parsed
    try {
        parsed = new URL(raw.trim())
    } catch {
        throw new Error('invalid provider URL')
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
        throw new Error('provider URL must use http(s) without credentials or fragment')
    }
    if (parsed.port && (!/^\d+$/.test(parsed.port) || Number(parsed.port) < 1 || Number(parsed.port) > 65535)) {
        throw new Error('invalid provider URL port')
    }

    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (!hostname || isLocalHost(hostname)) {
        if (!allowLocal && !isTrustedOllamaUrl(parsed)) throw new Error('local provider URL is disabled')
    }

    let records
    try {
        records = isIP(hostname) ? [{address: hostname}] : await dns.lookup(hostname, {all: true, verbatim: true})
    } catch {
        throw new Error('provider hostname could not be resolved')
    }
    if (!records.length || (!isLocalHost(hostname) && records.some((record) => isPrivateAddress(record.address)))) {
        throw new Error('provider URL resolves to a non-public address')
    }
    return {parsed, address: records[0].address, family: records[0].family || isIP(records[0].address)}
}

export async function resolveProviderUrl(raw, options = {}) {
    return resolveProviderTarget(raw, options)
}

export async function validateProviderUrl(raw, options = {}) {
    return (await resolveProviderTarget(raw, options)).parsed
}

// Node 24 在启用 autoSelectFamily 时会以 options.all=true 调用 lookup；必须按请求
// 形态返回地址数组，否则 Node 会把单个地址当作数组处理并抛出误导性的 IP 错误。
export function createPinnedLookup(address, family) {
    if (typeof address !== 'string' || !address || !isIP(address)) {
        throw new Error('invalid resolved provider address')
    }
    const resolvedFamily = family || isIP(address)
    return (_hostname, options, callback) => {
        if (options?.all) return callback(null, [{address, family: resolvedFamily}])
        return callback(null, address, resolvedFamily)
    }
}

export function resolveProviderRedirect(currentUrl, location, allowedOrigin = new URL(currentUrl).origin) {
    const next = new URL(location, currentUrl)
    if (next.origin !== allowedOrigin) throw new Error('provider cross-origin redirect is not allowed')
    return next.toString()
}

export function buildProviderModelsUrl(raw) {
    const baseUrl = raw.trim()
    if (baseUrl.includes('dashscope.aliyuncs.com')) {
        return baseUrl.replace(/\/apps\/anthropic\/?$/, '/compatible-mode/v1/models')
    }
    if (baseUrl.endsWith('/v1/messages')) {
        return baseUrl.replace(/\/v1\/messages\/?$/, '/v1/models')
    }
    if (baseUrl.includes('opencode')) {
        return baseUrl.replace(/\/+$/, '').replace(/\/zen\/v\d+/, '/zen/go/v1') + '/models'
    }
    if (baseUrl.includes('minimax')) {
        return baseUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '') + '/v1/models'
    }
    return baseUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '') + '/models'
}

export function buildProviderFallbackUrls(raw) {
    const u = new URL(raw)
    const origin = u.origin
    const pathBase = u.pathname.replace(/\/+$/, '')
    const candidates = [origin + '/v1/models']
    if (pathBase && pathBase !== '/') {
        candidates.unshift(origin + pathBase + '/v1/models')
        const parent = pathBase.replace(/\/[^/]+$/, '')
        if (parent && parent !== '/' && parent !== pathBase) candidates.unshift(origin + parent + '/v1/models')
    }
    return [...new Set(candidates)]
}
