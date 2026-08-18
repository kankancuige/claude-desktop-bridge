import {createRequire} from 'node:module'
import {existsSync, mkdirSync, renameSync} from 'node:fs'
import {dirname, join} from 'node:path'

const require = createRequire(import.meta.url)
const SCHEMA_VERSION = 2

function isCorruptDatabaseError(error) {
    const code = String(error?.code || '').toUpperCase()
    const message = String(error?.message || '').toLowerCase()
    return code.includes('CORRUPT') || code.includes('NOTADB')
        || message.includes('database disk image is malformed')
        || message.includes('file is not a database')
}

function quarantineDatabaseFiles(dbPath, now = Date.now()) {
    const suffix = `.corrupt-${now}`
    const quarantined = []
    for (const source of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        if (!existsSync(source)) continue
        const target = `${source}${suffix}`
        renameSync(source, target)
        quarantined.push(target)
    }
    return quarantined
}

function loadDriver() {
    const builtin = typeof process.getBuiltinModule === 'function'
        ? process.getBuiltinModule('node:sqlite')
        : null
    if (builtin?.DatabaseSync) return {kind: 'node:sqlite', Database: builtin.DatabaseSync}
    try {
        const Database = require('better-sqlite3')
        return {kind: 'better-sqlite3', Database}
    } catch (error) {
        return {kind: 'unavailable', error}
    }
}

function safeJson(value, fallback = {}) {
    try {
        return JSON.stringify(value ?? fallback)
    } catch (error) {
        throw Object.assign(new TypeError('SQLite 状态值不可序列化'), {code: 'STATE_STORE_SERIALIZATION_FAILED', cause: error})
    }
}

function parseJson(value, fallback = {}) {
    if (value === null || value === undefined || value === '') return fallback
    try { return JSON.parse(value) } catch { return fallback }
}

function normalizePlatform(value) {
    const platform = String(value || '')
    if (!/^[a-z0-9_-]{1,32}$/.test(platform)) throw new TypeError('invalid state store platform')
    return platform
}

function normalizeKind(value) {
    const kind = String(value || '')
    if (!/^[a-z0-9_-]{1,32}$/.test(kind)) throw new TypeError('invalid state store kind')
    return kind
}

function normalizeEntryId(value) {
    const id = String(value || '').trim()
    if (!id || id.length > 240 || /[\0\r\n]/.test(id)) throw new TypeError('invalid state store entry id')
    return id
}

function entryColumns(value) {
    return {
        state: typeof value?.state === 'string' ? value.state.slice(0, 32) : null,
        updatedAt: Number.isFinite(value?.updatedAt) ? Number(value.updatedAt) : Date.now(),
        nextAttemptAt: Number.isFinite(value?.nextAttemptAt) ? Number(value.nextAttemptAt) : null,
        attempts: Number.isFinite(value?.attempts) ? Number(value.attempts) : 0,
        payload: typeof value?.payload === 'string' ? value.payload : null,
    }
}

export function bridgeStateDbPath(bridgeHome) {
    if (typeof bridgeHome !== 'string' || !bridgeHome) throw new TypeError('bridgeHome is required')
    return join(bridgeHome, 'bridge-state.db')
}

export class BridgeStateDb {
    constructor({bridgeHome, dbPath = null, logger = null, required = false, now = () => Date.now()} = {}) {
        if (!bridgeHome && !dbPath) throw new TypeError('bridgeHome or dbPath is required')
        this.path = dbPath || bridgeStateDbPath(bridgeHome)
        this.logger = logger
        this.now = now
        this.mode = 'unavailable'
        this.schemaVersion = 0
        this.degraded = false
        this.degradedReason = null
        this.quarantinePaths = []
        this.db = null
        this.driver = null
        mkdirSync(dirname(this.path), {recursive: true})

        const driver = loadDriver()
        if (driver.kind === 'unavailable') {
            this.degraded = true
            this.degradedReason = 'driver_unavailable'
            this.error = driver.error
            if (required) throw Object.assign(new Error('SQLite native driver unavailable'), {code: 'STATE_STORE_DRIVER_UNAVAILABLE', cause: driver.error})
            return
        }
        try {
            this.driver = driver.kind
            this.db = driver.kind === 'node:sqlite'
                ? new driver.Database(this.path, {timeout: 5000})
                : new driver.Database(this.path, {timeout: 5000})
            this._configure()
            this._migrate()
            this.mode = 'sqlite'
            this.schemaVersion = SCHEMA_VERSION
        } catch (error) {
            this.degraded = true
            this.degradedReason = isCorruptDatabaseError(error) ? 'database_corrupt' : 'initialization_failed'
            this.error = error
            try { this.db?.close?.() } catch (closeError) { this.logger?.warn?.({err: closeError}, '关闭失效 SQLite 状态库失败') }
            this.db = null
            if (this.degradedReason === 'database_corrupt') {
                try {
                    this.quarantinePaths = quarantineDatabaseFiles(this.path, this.now())
                } catch (quarantineError) {
                    this.logger?.error?.({err: quarantineError, path: this.path}, '隔离损坏 SQLite 状态库失败')
                }
            }
            this.logger?.warn?.({
                err: error,
                path: this.path,
                degradedReason: this.degradedReason,
                quarantinePaths: this.quarantinePaths,
            }, 'SQLite 状态库不可用，将由调用方选择文件降级')
            if (required) throw Object.assign(new Error('SQLite 状态库初始化失败'), {code: 'STATE_STORE_INIT_FAILED', cause: error})
        }
    }

    get available() { return this.mode === 'sqlite' && !!this.db }

    _exec(sql) {
        return this.db.exec(sql)
    }

    _prepare(sql) {
        return this.db.prepare(sql)
    }

    _run(statement, ...params) {
        return statement.run(...params)
    }

    _configure() {
        this._exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    }

    _migrate() {
        this._exec(`
            CREATE TABLE IF NOT EXISTS bridge_schema (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                version INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS bridge_state_entries (
                kind TEXT NOT NULL,
                platform TEXT NOT NULL,
                entry_id TEXT NOT NULL,
                state TEXT,
                updated_at INTEGER NOT NULL,
                next_attempt_at INTEGER,
                attempts INTEGER NOT NULL DEFAULT 0,
                payload TEXT,
                data_json TEXT NOT NULL,
                PRIMARY KEY (kind, platform, entry_id)
            );
            CREATE INDEX IF NOT EXISTS idx_bridge_state_due
                ON bridge_state_entries (kind, platform, state, next_attempt_at, updated_at);
            CREATE TABLE IF NOT EXISTS bridge_session_index (
                project_key TEXT NOT NULL,
                session_id TEXT NOT NULL,
                sdk_session_id TEXT,
                work_dir TEXT,
                source TEXT,
                visibility TEXT,
                transcript_path TEXT NOT NULL,
                mtime REAL NOT NULL,
                size INTEGER NOT NULL,
                title TEXT,
                content_hash TEXT,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (project_key, session_id),
                UNIQUE (transcript_path)
            );
            CREATE INDEX IF NOT EXISTS idx_bridge_session_recent
                ON bridge_session_index (project_key, mtime DESC);
            CREATE TABLE IF NOT EXISTS bridge_memory_index (
                project_key TEXT NOT NULL,
                source_path TEXT NOT NULL,
                title TEXT NOT NULL,
                keywords TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                mtime REAL NOT NULL,
                size INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                scope TEXT NOT NULL DEFAULT 'project',
                confidence REAL NOT NULL DEFAULT 1,
                last_verified_at INTEGER,
                expires_at INTEGER,
                last_used_at INTEGER,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (project_key, source_path)
            );
            CREATE INDEX IF NOT EXISTS idx_bridge_memory_lookup
                ON bridge_memory_index (project_key, status, updated_at DESC);
        `)
        this._ensureColumn('bridge_memory_index', 'scope', "TEXT NOT NULL DEFAULT 'project'")
        this._ensureColumn('bridge_memory_index', 'confidence', 'REAL NOT NULL DEFAULT 1')
        this._ensureColumn('bridge_memory_index', 'expires_at', 'INTEGER')
        this._ensureColumn('bridge_memory_index', 'last_used_at', 'INTEGER')
        const row = this._prepare('SELECT version FROM bridge_schema WHERE id = 1').get()
        const current = Number(row?.version || 0)
        if (current > SCHEMA_VERSION) throw new Error(`不支持的 SQLite schema 版本: ${current}`)
        this._run(this._prepare(`
            INSERT INTO bridge_schema (id, version, updated_at) VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at
        `), SCHEMA_VERSION, this.now())
    }

    _ensureColumn(table, column, declaration) {
        const columns = this._prepare(`PRAGMA table_info(${table})`).all()
        if (columns.some(item => item.name === column)) return
        this._exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`)
    }

    transaction(callback) {
        if (!this.available) throw Object.assign(new Error('SQLite 状态库不可用'), {code: 'STATE_STORE_UNAVAILABLE'})
        this._exec('BEGIN IMMEDIATE')
        try {
            const result = callback()
            this._exec('COMMIT')
            return result
        } catch (error) {
            try { this._exec('ROLLBACK') } catch (rollbackError) { this.logger?.warn?.({err: rollbackError}, 'SQLite 回滚失败') }
            throw error
        }
    }

    loadEntries(kind, platform) {
        if (!this.available) return new Map()
        const safeKind = normalizeKind(kind)
        const safePlatform = normalizePlatform(platform)
        const rows = this._prepare('SELECT entry_id, data_json FROM bridge_state_entries WHERE kind = ? AND platform = ?').all(safeKind, safePlatform)
        const result = new Map()
        for (const row of rows) result.set(row.entry_id, parseJson(row.data_json, null))
        return result
    }

    replaceEntries(kind, platform, entries) {
        if (!this.available) return false
        const safeKind = normalizeKind(kind)
        const safePlatform = normalizePlatform(platform)
        this.transaction(() => {
            this._run(this._prepare('DELETE FROM bridge_state_entries WHERE kind = ? AND platform = ?'), safeKind, safePlatform)
            const insert = this._prepare(`
                INSERT INTO bridge_state_entries
                    (kind, platform, entry_id, state, updated_at, next_attempt_at, attempts, payload, data_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            for (const [rawId, value] of entries || []) {
                const id = normalizeEntryId(rawId)
                const columns = entryColumns(value)
                this._run(insert, safeKind, safePlatform, id, columns.state, columns.updatedAt, columns.nextAttemptAt, columns.attempts, columns.payload, safeJson(value))
            }
        })
        return true
    }

    clearEntries(kind, platform) {
        if (!this.available) return 0
        const result = this._run(
            this._prepare('DELETE FROM bridge_state_entries WHERE kind = ? AND platform = ?'),
            normalizeKind(kind),
            normalizePlatform(platform),
        )
        return Number(result?.changes || 0)
    }

    summarizeEntries(kind, platform, states = ['pending', 'failed', 'dead', 'sent']) {
        const summary = Object.fromEntries(states.map(state => [state, 0]))
        if (!this.available) return summary
        const rows = this._prepare(`
            SELECT state, COUNT(*) AS count
            FROM bridge_state_entries
            WHERE kind = ? AND platform = ?
            GROUP BY state
        `).all(normalizeKind(kind), normalizePlatform(platform))
        for (const row of rows) {
            if (Object.hasOwn(summary, row.state)) summary[row.state] = Number(row.count || 0)
        }
        return summary
    }

    upsertSessionIndex(record) {
        if (!this.available) return false
        const values = {
            projectKey: String(record?.projectKey || ''), sessionId: normalizeEntryId(record?.sessionId),
            sdkSessionId: record?.sdkSessionId ? String(record.sdkSessionId) : null,
            workDir: record?.workDir ? String(record.workDir) : null, source: record?.source ? String(record.source) : null,
            visibility: record?.visibility ? String(record.visibility) : null, transcriptPath: String(record?.transcriptPath || ''),
            mtime: Number(record?.mtime || 0), size: Number(record?.size || 0), title: record?.title ? String(record.title).slice(0, 500) : null,
            contentHash: record?.contentHash ? String(record.contentHash).slice(0, 128) : null, updatedAt: this.now(),
        }
        if (!values.projectKey || !values.transcriptPath) throw new TypeError('session index projectKey and transcriptPath are required')
        this._run(this._prepare(`
            INSERT INTO bridge_session_index
                (project_key, session_id, sdk_session_id, work_dir, source, visibility, transcript_path, mtime, size, title, content_hash, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_key, session_id) DO UPDATE SET
                sdk_session_id=excluded.sdk_session_id, work_dir=excluded.work_dir, source=excluded.source,
                visibility=excluded.visibility, transcript_path=excluded.transcript_path, mtime=excluded.mtime,
                size=excluded.size, title=excluded.title, content_hash=excluded.content_hash, updated_at=excluded.updated_at
        `), values.projectKey, values.sessionId, values.sdkSessionId, values.workDir, values.source, values.visibility, values.transcriptPath, values.mtime, values.size, values.title, values.contentHash, values.updatedAt)
        return values
    }

    listSessionIndex(projectKey, {limit = 100} = {}) {
        if (!this.available) return []
        return this._prepare(`
            SELECT project_key as projectKey, session_id as sessionId, sdk_session_id as sdkSessionId,
                work_dir as workDir, source, visibility, transcript_path as transcriptPath, mtime, size,
                title, content_hash as contentHash, updated_at as updatedAt
            FROM bridge_session_index WHERE project_key = ? ORDER BY mtime DESC LIMIT ?
        `).all(String(projectKey || ''), Math.max(1, Math.min(500, Number(limit) || 100)))
    }

    removeSessionIndex(transcriptPath) {
        if (!this.available || !transcriptPath) return false
        this._run(this._prepare('DELETE FROM bridge_session_index WHERE transcript_path = ?'), String(transcriptPath))
        return true
    }

    clearSessionIndex(projectKey) {
        if (!this.available || !projectKey) return 0
        const result = this._run(this._prepare('DELETE FROM bridge_session_index WHERE project_key = ?'), String(projectKey))
        return Number(result?.changes || 0)
    }

    upsertMemoryIndex(record) {
        if (!this.available) return false
        const projectKey = String(record?.projectKey || '')
        const sourcePath = String(record?.sourcePath || '')
        if (!projectKey || !sourcePath) throw new TypeError('memory index projectKey and sourcePath are required')
        this._run(this._prepare(`
            INSERT INTO bridge_memory_index
                (project_key, source_path, title, keywords, content_hash, mtime, size, status, scope, confidence,
                 last_verified_at, expires_at, last_used_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_key, source_path) DO UPDATE SET
                title=excluded.title, keywords=excluded.keywords, content_hash=excluded.content_hash,
                mtime=excluded.mtime, size=excluded.size, status=excluded.status,
                scope=excluded.scope, confidence=excluded.confidence, last_verified_at=excluded.last_verified_at,
                expires_at=excluded.expires_at, last_used_at=COALESCE(excluded.last_used_at, bridge_memory_index.last_used_at),
                updated_at=excluded.updated_at
        `), projectKey, sourcePath, String(record.title || '').slice(0, 500), String(record.keywords || '').slice(0, 2000), String(record.contentHash || '').slice(0, 128), Number(record.mtime || 0), Number(record.size || 0), String(record.status || 'active'), String(record.scope || 'project'), Math.max(0, Math.min(1, Number(record.confidence ?? 1))), Number.isFinite(record.lastVerifiedAt) ? Number(record.lastVerifiedAt) : null, Number.isFinite(record.expiresAt) ? Number(record.expiresAt) : null, Number.isFinite(record.lastUsedAt) ? Number(record.lastUsedAt) : null, this.now())
        return true
    }

    listMemoryIndex(projectKey, {status = 'active', limit = 100} = {}) {
        if (!this.available) return []
        const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100))
        const select = `
            SELECT project_key || ':' || source_path as id, project_key as projectKey, source_path as sourcePath,
                title, keywords, content_hash as contentHash, mtime, size, status, scope, confidence,
                last_verified_at as lastVerifiedAt, expires_at as expiresAt, last_used_at as lastUsedAt,
                updated_at as updatedAt
            FROM bridge_memory_index WHERE project_key = ?`
        if (status === null || status === 'all') {
            return this._prepare(`${select} ORDER BY updated_at DESC LIMIT ?`).all(String(projectKey || ''), safeLimit)
        }
        return this._prepare(`${select} AND status = ? ORDER BY updated_at DESC LIMIT ?`)
            .all(String(projectKey || ''), String(status || 'active'), safeLimit)
    }

    removeMemoryIndex(projectKey, sourcePath) {
        if (!this.available || !projectKey || !sourcePath) return false
        this._run(this._prepare('DELETE FROM bridge_memory_index WHERE project_key = ? AND source_path = ?'), String(projectKey), String(sourcePath))
        return true
    }

    clearMemoryIndex(projectKey) {
        if (!this.available || !projectKey) return 0
        const result = this._run(this._prepare('DELETE FROM bridge_memory_index WHERE project_key = ?'), String(projectKey))
        return Number(result?.changes || 0)
    }

    markMemoryUsed(projectKey, sourcePath, usedAt = this.now()) {
        if (!this.available || !projectKey || !sourcePath) return false
        const result = this._run(this._prepare(`
            UPDATE bridge_memory_index SET last_used_at = ?, updated_at = ?
            WHERE project_key = ? AND source_path = ?
        `), Number(usedAt), this.now(), String(projectKey), String(sourcePath))
        return Number(result?.changes || 0) > 0
    }

    close() {
        if (!this.db) return
        try { this.db.close() } finally { this.db = null; this.mode = 'closed' }
    }
}

export function createBridgeStateDb(options = {}) {
    return new BridgeStateDb(options)
}
