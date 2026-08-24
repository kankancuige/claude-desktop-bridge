const DEFAULT_SCHEMA = 'bridge'
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 10000

function boundedTimeout(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 3000
    return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.trunc(parsed)))
}

function localHost(value) {
    const host = String(value || '').trim().toLowerCase()
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function redactConnectionString(value) {
    try {
        const url = new URL(value)
        if (url.password) url.password = '[redacted]'
        if (url.username) url.username = '[user]'
        return url.toString()
    } catch {
        return '[invalid-connection-string]'
    }
}

export function readPostgresStorageConfig(env = process.env) {
    const backend = String(env.BRIDGE_STORAGE_BACKEND || '').trim().toLowerCase()
    const connectionString = String(env.BRIDGE_POSTGRES_URL || '').trim()
    const schema = String(env.BRIDGE_POSTGRES_SCHEMA || DEFAULT_SCHEMA).trim()
    const statementTimeoutMs = boundedTimeout(env.BRIDGE_POSTGRES_STATEMENT_TIMEOUT_MS)
    if (!backend) throw Object.assign(new Error('BRIDGE_STORAGE_BACKEND 未配置，必须使用 PostgreSQL'), {code: 'STORAGE_BACKEND_REQUIRED'})
    if (backend !== 'postgres') throw Object.assign(new Error('只支持 PostgreSQL'), {code: 'STORAGE_BACKEND_INVALID'})
    if (!connectionString) throw Object.assign(new Error('BRIDGE_POSTGRES_URL 未配置'), {code: 'STORAGE_POSTGRES_URL_MISSING'})
    let parsed
    try { parsed = new URL(connectionString) } catch (error) { throw Object.assign(new Error('BRIDGE_POSTGRES_URL 无效'), {code: 'STORAGE_POSTGRES_URL_INVALID', cause: error}) }
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') throw Object.assign(new Error('BRIDGE_POSTGRES_URL 协议无效'), {code: 'STORAGE_POSTGRES_PROTOCOL_INVALID'})
    if (!localHost(parsed.hostname)) throw Object.assign(new Error('本地 Bridge 只允许连接本机 PostgreSQL'), {code: 'STORAGE_POSTGRES_HOST_NOT_LOCAL'})
    if (!/^[a-z_][a-z0-9_]{0,62}$/i.test(schema)) throw Object.assign(new Error('BRIDGE_POSTGRES_SCHEMA 无效'), {code: 'STORAGE_POSTGRES_SCHEMA_INVALID'})
    return {enabled: true, mode: 'postgres', connectionString, schema, statementTimeoutMs, safeConnectionString: redactConnectionString(connectionString)}
}

export {boundedTimeout}
