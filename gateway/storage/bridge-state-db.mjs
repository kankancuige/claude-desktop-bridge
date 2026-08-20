import {createRequire} from 'node:module'
import {existsSync, mkdirSync, renameSync} from 'node:fs'
import {dirname, join} from 'node:path'

const require = createRequire(import.meta.url)
const SCHEMA_VERSION = 4

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
                last_opened_at INTEGER,
                permission_mode TEXT,
                mirrors_json TEXT,
                runtime_revision INTEGER,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (project_key, session_id),
                UNIQUE (transcript_path)
            );
            CREATE INDEX IF NOT EXISTS idx_bridge_session_visibility
                ON bridge_session_index (project_key, visibility, mtime DESC);
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
            CREATE TABLE IF NOT EXISTS bridge_task_state (
                project_key TEXT NOT NULL,
                task_key TEXT NOT NULL,
                session_id TEXT,
                task_id TEXT,
                sdk_session_id TEXT,
                status TEXT NOT NULL,
                outcome TEXT,
                continuation_reason TEXT,
                phase TEXT,
                review_state TEXT,
                model_tier TEXT,
                error_code TEXT,
                sequence INTEGER NOT NULL DEFAULT 0,
                revision INTEGER NOT NULL DEFAULT 0,
                started_at INTEGER,
                completed_at INTEGER,
                updated_at INTEGER NOT NULL,
                notifications_json TEXT,
                state_json TEXT NOT NULL,
                PRIMARY KEY (project_key, task_key)
            );
            CREATE INDEX IF NOT EXISTS idx_bridge_task_active
                ON bridge_task_state (project_key, status, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_bridge_task_session
                ON bridge_task_state (project_key, session_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS bridge_task_events (
                project_key TEXT NOT NULL,
                task_key TEXT NOT NULL,
                revision INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                event_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (project_key, task_key, revision),
                FOREIGN KEY (project_key, task_key)
                    REFERENCES bridge_task_state(project_key, task_key)
                    ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS bridge_workflow_state (
                project_key TEXT NOT NULL,
                workflow_id TEXT NOT NULL,
                parent_session_id TEXT,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                current_phase TEXT,
                token_spent INTEGER NOT NULL DEFAULT 0,
                started_at INTEGER,
                ended_at INTEGER,
                revision INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL,
                state_json TEXT NOT NULL,
                PRIMARY KEY (project_key, workflow_id)
            );
            CREATE INDEX IF NOT EXISTS idx_bridge_workflow_session
                ON bridge_workflow_state (project_key, parent_session_id, status, updated_at DESC);
        `)
        this._ensureColumn('bridge_memory_index', 'scope', "TEXT NOT NULL DEFAULT 'project'")
        this._ensureColumn('bridge_memory_index', 'confidence', 'REAL NOT NULL DEFAULT 1')
        this._ensureColumn('bridge_memory_index', 'expires_at', 'INTEGER')
        this._ensureColumn('bridge_memory_index', 'last_used_at', 'INTEGER')
        this._ensureColumn('bridge_session_index', 'last_opened_at', 'INTEGER')
        this._ensureColumn('bridge_session_index', 'permission_mode', 'TEXT')
        this._ensureColumn('bridge_session_index', 'mirrors_json', 'TEXT')
        this._ensureColumn('bridge_session_index', 'runtime_revision', 'INTEGER')
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
            contentHash: record?.contentHash ? String(record.contentHash).slice(0, 128) : null,
            lastOpenedAt: Number.isFinite(record?.lastOpenedAt) ? Number(record.lastOpenedAt) : null,
            permissionMode: record?.permissionMode ? String(record.permissionMode).slice(0, 32) : null,
            mirrorsJson: record?.mirrors ? safeJson(record.mirrors) : null,
            runtimeRevision: Number.isFinite(record?.runtimeRevision) ? Number(record.runtimeRevision) : null,
            updatedAt: this.now(),
        }
        if (!values.projectKey || !values.transcriptPath) throw new TypeError('session index projectKey and transcriptPath are required')
        const pathOwner = this._prepare(`
            SELECT project_key as projectKey, session_id as sessionId, sdk_session_id as sdkSessionId,
                work_dir as workDir, source, visibility, mtime, size, title, content_hash as contentHash,
                last_opened_at as lastOpenedAt, permission_mode as permissionMode, mirrors_json as mirrorsJson,
                runtime_revision as runtimeRevision
            FROM bridge_session_index WHERE transcript_path = ?
        `).get(values.transcriptPath)
        const changesOwner = pathOwner && (pathOwner.projectKey !== values.projectKey || pathOwner.sessionId !== values.sessionId)
        if (changesOwner) {
            values.sdkSessionId ??= pathOwner.sdkSessionId
            values.workDir ??= pathOwner.workDir
            values.source ??= pathOwner.source
            values.visibility ??= pathOwner.visibility
            if (values.mtime <= 0) values.mtime = Number(pathOwner.mtime || 0)
            if (values.size <= 0) values.size = Number(pathOwner.size || 0)
            values.title ??= pathOwner.title
            values.contentHash ??= pathOwner.contentHash
            values.lastOpenedAt ??= pathOwner.lastOpenedAt
            values.permissionMode ??= pathOwner.permissionMode
            values.mirrorsJson ??= pathOwner.mirrorsJson
            values.runtimeRevision ??= pathOwner.runtimeRevision
        }
        const upsert = () => this._run(this._prepare(`
            INSERT INTO bridge_session_index
                (project_key, session_id, sdk_session_id, work_dir, source, visibility, transcript_path, mtime, size, title, content_hash,
                 last_opened_at, permission_mode, mirrors_json, runtime_revision, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_key, session_id) DO UPDATE SET
                sdk_session_id=COALESCE(excluded.sdk_session_id, bridge_session_index.sdk_session_id),
                work_dir=COALESCE(excluded.work_dir, bridge_session_index.work_dir),
                source=COALESCE(excluded.source, bridge_session_index.source),
                visibility=COALESCE(excluded.visibility, bridge_session_index.visibility),
                transcript_path=COALESCE(excluded.transcript_path, bridge_session_index.transcript_path),
                mtime=CASE WHEN excluded.mtime > 0 THEN excluded.mtime ELSE bridge_session_index.mtime END,
                size=CASE WHEN excluded.size > 0 THEN excluded.size ELSE bridge_session_index.size END,
                title=COALESCE(excluded.title, bridge_session_index.title),
                content_hash=COALESCE(excluded.content_hash, bridge_session_index.content_hash),
                last_opened_at=COALESCE(excluded.last_opened_at, bridge_session_index.last_opened_at),
                permission_mode=COALESCE(excluded.permission_mode, bridge_session_index.permission_mode),
                mirrors_json=COALESCE(excluded.mirrors_json, bridge_session_index.mirrors_json),
                runtime_revision=COALESCE(excluded.runtime_revision, bridge_session_index.runtime_revision),
                updated_at=excluded.updated_at
        `), values.projectKey, values.sessionId, values.sdkSessionId, values.workDir, values.source, values.visibility, values.transcriptPath, values.mtime, values.size, values.title, values.contentHash, values.lastOpenedAt, values.permissionMode, values.mirrorsJson, values.runtimeRevision, values.updatedAt)
        if (changesOwner) {
            this._exec('SAVEPOINT bridge_session_path_transfer')
            try {
                this._run(this._prepare('DELETE FROM bridge_session_index WHERE transcript_path = ?'), values.transcriptPath)
                upsert()
                this._exec('RELEASE SAVEPOINT bridge_session_path_transfer')
            } catch (error) {
                try {
                    this._exec('ROLLBACK TO SAVEPOINT bridge_session_path_transfer')
                    this._exec('RELEASE SAVEPOINT bridge_session_path_transfer')
                } catch (rollbackError) {
                    this.logger?.warn?.({err: rollbackError}, 'SQLite 会话索引路径转移回滚失败')
                }
                throw error
            }
        } else {
            upsert()
        }
        return values
    }

    upsertSessionCatalog(record) {
        return this.upsertSessionIndex(record)
    }

    upsertSessionCatalogBatch(records = []) {
        if (!this.available) return false
        const items = Array.isArray(records) ? records : []
        if (!items.length) return true
        this.transaction(() => {
            for (const record of items) this.upsertSessionIndex(record)
        })
        return true
    }

    listSessionIndex(projectKey, {limit = 100, visibility = null} = {}) {
        if (!this.available) return []
        const where = visibility ? ' AND visibility = ?' : ''
        const params = visibility ? [String(projectKey || ''), String(visibility), Math.max(1, Math.min(500, Number(limit) || 100))] : [String(projectKey || ''), Math.max(1, Math.min(500, Number(limit) || 100))]
        const rows = this._prepare(`
            SELECT project_key as projectKey, session_id as sessionId, sdk_session_id as sdkSessionId,
                work_dir as workDir, source, visibility, transcript_path as transcriptPath, mtime, size,
                title, content_hash as contentHash, last_opened_at as lastOpenedAt,
                permission_mode as permissionMode, mirrors_json as mirrorsJson,
                runtime_revision as runtimeRevision, updated_at as updatedAt
            FROM bridge_session_index WHERE project_key = ?${where} ORDER BY mtime DESC LIMIT ?
        `).all(...params)
        return rows.map(row => ({...row, mirrors: parseJson(row.mirrorsJson, null)}))
    }

    listVisibleSessions(projectKey, limit = 100) {
        return this.listSessionIndex(projectKey, {limit, visibility: 'visible'})
    }

    getSessionCatalog(projectKey, sessionId) {
        if (!this.available) return null
        const row = this._prepare(`
            SELECT project_key as projectKey, session_id as sessionId, sdk_session_id as sdkSessionId,
                work_dir as workDir, source, visibility, transcript_path as transcriptPath, mtime, size,
                title, content_hash as contentHash, last_opened_at as lastOpenedAt,
                permission_mode as permissionMode, mirrors_json as mirrorsJson,
                runtime_revision as runtimeRevision, updated_at as updatedAt
            FROM bridge_session_index WHERE project_key = ? AND session_id = ?
        `).get(String(projectKey || ''), normalizeEntryId(sessionId))
        return row ? {...row, mirrors: parseJson(row.mirrorsJson, null)} : null
    }

    getSessionCatalogs(projectKey, sessionIds = []) {
        if (!this.available) return new Map()
        const ids = [...new Set((Array.isArray(sessionIds) ? sessionIds : [sessionIds])
            .map(value => String(value || '').trim()).filter(Boolean))].slice(0, 5000)
        if (!ids.length) return new Map()
        const rows = []
        for (let offset = 0; offset < ids.length; offset += 500) {
            const batch = ids.slice(offset, offset + 500)
            const placeholders = batch.map(() => '?').join(', ')
            rows.push(...this._prepare(`
                SELECT project_key as projectKey, session_id as sessionId, sdk_session_id as sdkSessionId,
                    work_dir as workDir, source, visibility, transcript_path as transcriptPath, mtime, size,
                    title, content_hash as contentHash, last_opened_at as lastOpenedAt,
                    permission_mode as permissionMode, mirrors_json as mirrorsJson,
                    runtime_revision as runtimeRevision, updated_at as updatedAt
                FROM bridge_session_index
                WHERE project_key = ? AND session_id IN (${placeholders})
            `).all(String(projectKey || ''), ...batch))
        }
        return new Map(rows.map(row => [row.sessionId, {...row, mirrors: parseJson(row.mirrorsJson, null)}]))
    }

    updateSessionSettings(projectKey, sessionId, patch = {}) {
        if (!this.available) return false
        const fields = []
        const params = []
        if (Object.hasOwn(patch, 'lastOpenedAt')) {
            fields.push('last_opened_at = ?')
            params.push(Number.isFinite(patch.lastOpenedAt) ? Number(patch.lastOpenedAt) : null)
        }
        if (Object.hasOwn(patch, 'permissionMode')) {
            fields.push('permission_mode = ?')
            params.push(patch.permissionMode == null ? null : String(patch.permissionMode).slice(0, 32))
        }
        if (Object.hasOwn(patch, 'mirrors')) {
            fields.push('mirrors_json = ?')
            params.push(safeJson(patch.mirrors, {}))
        }
        if (Object.hasOwn(patch, 'runtimeRevision')) {
            fields.push('runtime_revision = ?')
            params.push(Number.isFinite(patch.runtimeRevision) ? Number(patch.runtimeRevision) : null)
        }
        if (!fields.length) return false
        fields.push('updated_at = ?')
        params.push(this.now(), String(projectKey || ''), normalizeEntryId(sessionId))
        const result = this._run(this._prepare(`
            UPDATE bridge_session_index SET ${fields.join(', ')}
            WHERE project_key = ? AND session_id = ?
        `), ...params)
        return Number(result?.changes || 0) > 0
    }

    updateSessionSettingsByIds(projectKey, ids, patch = {}) {
        if (!this.available) return false
        const normalizedIds = [...new Set((Array.isArray(ids) ? ids : [ids]).map(value => String(value || '').trim()).filter(Boolean))]
        if (!normalizedIds.length) return false
        const fields = []
        const params = []
        if (Object.hasOwn(patch, 'lastOpenedAt')) {
            fields.push('last_opened_at = ?')
            params.push(Number.isFinite(patch.lastOpenedAt) ? Number(patch.lastOpenedAt) : null)
        }
        if (Object.hasOwn(patch, 'permissionMode')) {
            fields.push('permission_mode = ?')
            params.push(patch.permissionMode == null ? null : String(patch.permissionMode).slice(0, 32))
        }
        if (Object.hasOwn(patch, 'mirrors')) {
            fields.push('mirrors_json = ?')
            params.push(safeJson(patch.mirrors, {}))
        }
        if (Object.hasOwn(patch, 'runtimeRevision')) {
            fields.push('runtime_revision = ?')
            params.push(Number.isFinite(patch.runtimeRevision) ? Number(patch.runtimeRevision) : null)
        }
        if (!fields.length) return false
        const placeholders = normalizedIds.map(() => '?').join(', ')
        fields.push('updated_at = ?')
        params.push(this.now(), String(projectKey || ''), ...normalizedIds, ...normalizedIds)
        const result = this._run(this._prepare(`
            UPDATE bridge_session_index SET ${fields.join(', ')}
            WHERE project_key = ? AND (session_id IN (${placeholders}) OR sdk_session_id IN (${placeholders}))
        `), ...params)
        return Number(result?.changes || 0) > 0
    }

    removeSessionIndex(transcriptPath) {
        if (!this.available || !transcriptPath) return false
        this._run(this._prepare('DELETE FROM bridge_session_index WHERE transcript_path = ?'), String(transcriptPath))
        return true
    }

    removeSessionCatalog(projectKey, sessionId) {
        if (!this.available) return false
        const result = this._run(this._prepare(
            'DELETE FROM bridge_session_index WHERE project_key = ? AND session_id = ?'
        ), String(projectKey || ''), normalizeEntryId(sessionId))
        return Number(result?.changes || 0) > 0
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

    _taskValues(record = {}) {
        const projectKey = String(record.projectKey || '')
        const taskKey = String(record.taskKey || record.taskId || record.sdkSessionId || record.sessionId || '').trim()
        if (!projectKey || !taskKey) throw new TypeError('task projection projectKey and taskKey are required')
        const state = record.state && typeof record.state === 'object' ? record.state : record
        const revision = Math.max(0, Math.trunc(Number(record.revision ?? state.revision ?? state.updatedAt ?? 0) || 0))
        const stateProjection = {
            version: state.version,
            status: state.status,
            outcome: state.outcome,
            continuationReason: state.continuationReason,
            resumable: state.resumable === true,
            permissionMode: state.permissionMode,
            subtype: state.subtype,
            sdkSessionId: state.sdkSessionId,
            historySessionId: state.historySessionId,
            taskId: state.taskId,
            turnId: state.turnId,
            sequence: state.sequence,
            numTurns: state.numTurns,
            startedAt: state.startedAt,
            completedAt: state.completedAt,
            durationMs: state.durationMs,
            notifications: state.notifications || {},
            review: state.review ? {
                round: state.review.round,
                tier: state.review.tier,
                blockingCount: state.review.blockingCount,
            } : null,
            updatedAt: state.updatedAt,
        }
        return {
            projectKey,
            taskKey: taskKey.slice(0, 240),
            sessionId: record.sessionId ? String(record.sessionId).slice(0, 240) : null,
            taskId: record.taskId || state.taskId ? String(record.taskId || state.taskId).slice(0, 240) : null,
            sdkSessionId: record.sdkSessionId || state.sdkSessionId ? String(record.sdkSessionId || state.sdkSessionId).slice(0, 240) : null,
            status: String(record.status || state.status || 'idle').slice(0, 32),
            outcome: record.outcome || state.outcome ? String(record.outcome || state.outcome).slice(0, 32) : null,
            continuationReason: record.continuationReason || state.continuationReason ? String(record.continuationReason || state.continuationReason).slice(0, 64) : null,
            phase: record.phase || state.status ? String(record.phase || state.status).slice(0, 32) : null,
            reviewState: record.reviewState || state.review?.tier ? String(record.reviewState || state.review?.tier).slice(0, 32) : null,
            modelTier: record.modelTier ? String(record.modelTier).slice(0, 32) : null,
            errorCode: record.errorCode ? String(record.errorCode).slice(0, 80) : null,
            sequence: Math.max(0, Math.trunc(Number(record.sequence ?? state.sequence) || 0)),
            revision,
            startedAt: Number.isFinite(Number(record.startedAt ?? state.startedAt)) ? Number(record.startedAt ?? state.startedAt) : null,
            completedAt: Number.isFinite(Number(record.completedAt ?? state.completedAt)) ? Number(record.completedAt ?? state.completedAt) : null,
            updatedAt: Number.isFinite(Number(record.updatedAt ?? state.updatedAt)) ? Number(record.updatedAt ?? state.updatedAt) : this.now(),
            notificationsJson: record.notifications || state.notifications ? safeJson(record.notifications || state.notifications, {}) : null,
            // 不把最终回复、transcript 正文或详细审查文本复制进 SQLite。
            stateJson: safeJson(stateProjection, {}),
        }
    }

    _upsertTaskStateUnsafe(record) {
        const values = this._taskValues(record)
        const result = this._run(this._prepare(`
            INSERT INTO bridge_task_state
                (project_key, task_key, session_id, task_id, sdk_session_id, status, outcome,
                 continuation_reason, phase, review_state, model_tier, error_code, sequence, revision,
                 started_at, completed_at, updated_at, notifications_json, state_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_key, task_key) DO UPDATE SET
                session_id=COALESCE(excluded.session_id, bridge_task_state.session_id),
                task_id=COALESCE(excluded.task_id, bridge_task_state.task_id),
                sdk_session_id=COALESCE(excluded.sdk_session_id, bridge_task_state.sdk_session_id),
                status=excluded.status, outcome=excluded.outcome,
                continuation_reason=excluded.continuation_reason, phase=excluded.phase,
                review_state=excluded.review_state, model_tier=COALESCE(excluded.model_tier, bridge_task_state.model_tier),
                error_code=excluded.error_code, sequence=excluded.sequence, revision=excluded.revision,
                started_at=excluded.started_at, completed_at=excluded.completed_at,
                updated_at=excluded.updated_at, notifications_json=excluded.notifications_json,
                state_json=excluded.state_json
            WHERE excluded.revision > bridge_task_state.revision
        `), values.projectKey, values.taskKey, values.sessionId, values.taskId, values.sdkSessionId,
            values.status, values.outcome, values.continuationReason, values.phase, values.reviewState,
            values.modelTier, values.errorCode, values.sequence, values.revision, values.startedAt,
            values.completedAt, values.updatedAt, values.notificationsJson, values.stateJson)
        return {values, changed: Number(result?.changes || 0) > 0}
    }

    upsertTaskState(record) {
        if (!this.available) return false
        this._upsertTaskStateUnsafe(record)
        return true
    }

    appendTaskEvent(record = {}) {
        if (!this.available) return false
        const values = this._taskValues(record)
        const revision = Math.max(1, values.revision || values.sequence || 1)
        const result = this._run(this._prepare(`
            INSERT OR IGNORE INTO bridge_task_events
                (project_key, task_key, revision, event_type, event_json, created_at)
            SELECT ?, ?, ?, ?, ?, ?
            WHERE EXISTS (
                SELECT 1 FROM bridge_task_state
                WHERE project_key = ? AND task_key = ? AND revision = ?
            )
        `), values.projectKey, values.taskKey, revision,
            String(record.eventType || 'task/state-changed').slice(0, 120),
            values.stateJson, this.now(), values.projectKey, values.taskKey, revision)
        return Number(result?.changes || 0) > 0
    }

    recordTaskTransition(record = {}) {
        if (!this.available) return false
        return this.transaction(() => {
            const {values, changed} = this._upsertTaskStateUnsafe(record)
            if (!changed) return false
            this._run(this._prepare(`
                INSERT OR IGNORE INTO bridge_task_events
                    (project_key, task_key, revision, event_type, event_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `), values.projectKey, values.taskKey, Math.max(1, values.revision || values.sequence || 1),
                String(record.eventType || 'task/state-changed').slice(0, 120), values.stateJson, this.now())
            return true
        })
    }

    updateTaskNotification({taskId, sessionId = null, platform, notificationId, state, lastError = '', updatedAt = this.now()} = {}) {
        if (!this.available) return false
        const safeTaskId = String(taskId || '').trim()
        const safeSessionId = String(sessionId || '').trim()
        if (!safeTaskId && !safeSessionId) return false
        const safePlatform = normalizePlatform(platform)
        const row = safeTaskId
            ? this._prepare('SELECT project_key as projectKey, task_key as taskKey FROM bridge_task_state WHERE task_id = ? ORDER BY updated_at DESC LIMIT 1').get(safeTaskId)
            : this._prepare('SELECT project_key as projectKey, task_key as taskKey FROM bridge_task_state WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1').get(safeSessionId)
        if (!row) return false
        return this.transaction(() => {
            const current = this._taskSelect('WHERE project_key = ? AND task_key = ?', [row.projectKey, row.taskKey])
            if (!current) return false
            const notifications = parseJson(current.notificationsJson, {})
            const previous = notifications[safePlatform] || {}
            notifications[safePlatform] = {
                ...previous,
                state: String(state || 'pending').slice(0, 32),
                notificationId: String(notificationId || previous.notificationId || '').slice(0, 240),
                lastError: String(lastError || '').slice(0, 200),
                updatedAt: Number(updatedAt) || this.now(),
            }
            const sourceState = parseJson(current.stateJson, {})
            const nextRevision = Math.max(1, Number(current.revision || 0) + 1)
            const {values, changed} = this._upsertTaskStateUnsafe({
                ...current,
                projectKey: current.projectKey,
                taskKey: current.taskKey,
                revision: nextRevision,
                updatedAt: Number(updatedAt) || this.now(),
                notifications,
                state: {...sourceState, notifications, updatedAt: Number(updatedAt) || this.now()},
            })
            if (!changed) return false
            this._run(this._prepare(`
                INSERT OR IGNORE INTO bridge_task_events
                    (project_key, task_key, revision, event_type, event_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `), values.projectKey, values.taskKey, nextRevision, 'task/notification-state-changed', values.stateJson, this.now())
            return true
        })
    }

    _taskSelect(where, params) {
        return this._prepare(`
            SELECT project_key as projectKey, task_key as taskKey, session_id as sessionId,
                task_id as taskId, sdk_session_id as sdkSessionId, status, outcome,
                continuation_reason as continuationReason, phase, review_state as reviewState,
                model_tier as modelTier, error_code as errorCode, sequence, revision,
                started_at as startedAt, completed_at as completedAt, updated_at as updatedAt,
                notifications_json as notificationsJson, state_json as stateJson
            FROM bridge_task_state ${where}
        `).get(...params)
    }

    getTaskState(projectKey, key) {
        if (!this.available) return null
        const project = String(projectKey || '')
        const value = String(key || '').trim()
        if (!project || !value) return null
        const row = this._taskSelect(
            'WHERE project_key = ? AND (task_key = ? OR task_id = ? OR sdk_session_id = ? OR session_id = ?) ORDER BY revision DESC LIMIT 1',
            [project, value, value, value, value],
        )
        if (!row) return null
        return {...row, notifications: parseJson(row.notificationsJson, {}), state: parseJson(row.stateJson, {})}
    }

    listTaskStates(projectKey, {activeOnly = false, limit = 100} = {}) {
        if (!this.available) return []
        const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100))
        const active = activeOnly ? " AND status IN ('running','reviewing','changes_required','fixing')" : ''
        const rows = this._prepare(`
            SELECT project_key as projectKey, task_key as taskKey, session_id as sessionId,
                task_id as taskId, sdk_session_id as sdkSessionId, status, outcome,
                continuation_reason as continuationReason, phase, review_state as reviewState,
                model_tier as modelTier, error_code as errorCode, sequence, revision,
                started_at as startedAt, completed_at as completedAt, updated_at as updatedAt,
                notifications_json as notificationsJson, state_json as stateJson
            FROM bridge_task_state WHERE project_key = ?${active}
            ORDER BY updated_at DESC LIMIT ?
        `).all(String(projectKey || ''), safeLimit)
        return rows.map(row => ({...row, notifications: parseJson(row.notificationsJson, {}), state: parseJson(row.stateJson, {})}))
    }

    listTaskNotificationIntents(platform, {limit = 100} = {}) {
        if (!this.available) return []
        const safePlatform = normalizePlatform(platform)
        const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100))
        const rows = this._prepare(`
            SELECT project_key as projectKey, task_key as taskKey, session_id as sessionId,
                task_id as taskId, sdk_session_id as sdkSessionId, status, outcome,
                continuation_reason as continuationReason, updated_at as updatedAt,
                notifications_json as notificationsJson
            FROM bridge_task_state
            WHERE status IN ('succeeded','failed','incomplete','review_paused','interrupted')
                AND notifications_json IS NOT NULL
            ORDER BY updated_at DESC LIMIT ?
        `).all(safeLimit)
        return rows.map(row => ({...row, notifications: parseJson(row.notificationsJson, {})}))
            .filter(row => ['pending', 'failed'].includes(row.notifications?.[safePlatform]?.state))
    }

    removeTaskState(projectKey, taskKey) {
        if (!this.available) return false
        const result = this._run(this._prepare('DELETE FROM bridge_task_state WHERE project_key = ? AND task_key = ?'), String(projectKey || ''), String(taskKey || ''))
        return Number(result?.changes || 0) > 0
    }

    pruneTaskState({projectKey = null, olderThanMs = 30 * 24 * 60 * 60 * 1000, maxRows = 1000} = {}) {
        if (!this.available) return 0
        const cutoff = this.now() - Math.max(60_000, Number(olderThanMs) || 0)
        const limit = Math.max(1, Math.min(10_000, Number(maxRows) || 1000))
        const terminal = "status IN ('succeeded','incomplete','failed','stopped','interrupted','review_paused')"
        const projectClause = projectKey == null ? '' : ' AND project_key = ?'
        const params = projectKey == null ? [cutoff, limit] : [cutoff, String(projectKey), limit]
        const candidates = this._prepare(`
            SELECT project_key as projectKey, task_key as taskKey, notifications_json as notificationsJson
            FROM bridge_task_state
            WHERE ${terminal} AND updated_at < ?${projectClause}
            ORDER BY updated_at ASC LIMIT ?
        `).all(...params)
        const removable = candidates.filter(row => {
            const notifications = parseJson(row.notificationsJson, {})
            return !Object.values(notifications).some(item => ['pending', 'failed', 'dead'].includes(item?.state))
        })
        if (!removable.length) return 0
        let deleted = 0
        this.transaction(() => {
            const statement = this._prepare('DELETE FROM bridge_task_state WHERE project_key = ? AND task_key = ?')
            for (const row of removable) deleted += Number(this._run(statement, row.projectKey, row.taskKey)?.changes || 0)
        })
        return deleted
    }

    upsertWorkflowState(record = {}) {
        if (!this.available) return false
        const projectKey = String(record.projectKey || '')
        const workflowId = String(record.workflowId || '').trim()
        if (!projectKey || !workflowId) throw new TypeError('workflow projection projectKey and workflowId are required')
        const sourceState = record.state && typeof record.state === 'object' ? record.state : {}
        const workflowProjection = {
            workflowId,
            name: String(record.name || sourceState.name || workflowId).slice(0, 200),
            status: String(record.status || sourceState.status || 'starting').slice(0, 32),
            currentPhase: record.currentPhase || sourceState.currentPhase || null,
            tokenSpent: Math.max(0, Math.trunc(Number(record.tokenSpent ?? sourceState.tokenSpent) || 0)),
            startedAt: Number.isFinite(Number(record.startedAt ?? sourceState.startedAt)) ? Number(record.startedAt ?? sourceState.startedAt) : null,
            endedAt: Number.isFinite(Number(record.endedAt ?? sourceState.endedAt)) ? Number(record.endedAt ?? sourceState.endedAt) : null,
            phases: Array.isArray(sourceState.phases) ? sourceState.phases.slice(-50).map(phase => ({
                title: String(phase?.title || '').slice(0, 200),
                status: String(phase?.status || '').slice(0, 32),
                startedAt: Number.isFinite(Number(phase?.startedAt)) ? Number(phase.startedAt) : null,
            })) : [],
            runKey: sourceState.runKey ? String(sourceState.runKey).slice(0, 240) : null,
            taskOwned: sourceState.taskOwned === true,
            returnsToParent: sourceState.returnsToParent !== false,
        }
        this._run(this._prepare(`
            INSERT INTO bridge_workflow_state
                (project_key, workflow_id, parent_session_id, name, status, current_phase,
                 token_spent, started_at, ended_at, revision, updated_at, state_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_key, workflow_id) DO UPDATE SET
                parent_session_id=COALESCE(excluded.parent_session_id, bridge_workflow_state.parent_session_id),
                name=excluded.name, status=excluded.status, current_phase=excluded.current_phase,
                token_spent=excluded.token_spent, started_at=excluded.started_at, ended_at=excluded.ended_at,
                revision=excluded.revision, updated_at=excluded.updated_at, state_json=excluded.state_json
            WHERE excluded.revision >= bridge_workflow_state.revision
        `), projectKey, workflowId.slice(0, 240), record.parentSessionId ? String(record.parentSessionId).slice(0, 240) : null,
            workflowProjection.name, workflowProjection.status,
            workflowProjection.currentPhase ? String(workflowProjection.currentPhase).slice(0, 200) : null,
            workflowProjection.tokenSpent, workflowProjection.startedAt, workflowProjection.endedAt,
            Math.max(0, Math.trunc(Number(record.revision) || 0)), this.now(), safeJson(workflowProjection, {}))
        return true
    }

    listWorkflowStates(projectKey, {parentSessionId = null, limit = 100} = {}) {
        if (!this.available) return []
        const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100))
        const where = parentSessionId == null ? 'WHERE project_key = ?' : 'WHERE project_key = ? AND parent_session_id = ?'
        const params = parentSessionId == null ? [String(projectKey || ''), safeLimit] : [String(projectKey || ''), String(parentSessionId), safeLimit]
        return this._prepare(`
            SELECT project_key as projectKey, workflow_id as workflowId, parent_session_id as parentSessionId,
                name, status, current_phase as currentPhase, token_spent as tokenSpent,
                started_at as startedAt, ended_at as endedAt, revision, updated_at as updatedAt,
                state_json as stateJson
            FROM bridge_workflow_state ${where} ORDER BY updated_at DESC LIMIT ?
        `).all(...params).map(row => ({...row, state: parseJson(row.stateJson, {})}))
    }

    pruneWorkflowState({projectKey = null, olderThanMs = 30 * 24 * 60 * 60 * 1000, maxRows = 1000} = {}) {
        if (!this.available) return 0
        const cutoff = this.now() - Math.max(60_000, Number(olderThanMs) || 0)
        const limit = Math.max(1, Math.min(10_000, Number(maxRows) || 1000))
        const projectClause = projectKey == null ? '' : ' AND project_key = ?'
        const params = projectKey == null ? [cutoff, limit] : [cutoff, String(projectKey), limit]
        const result = this._run(this._prepare(`
            DELETE FROM bridge_workflow_state
            WHERE rowid IN (
                SELECT rowid FROM bridge_workflow_state
                WHERE status IN ('done','error','paused','committed') AND updated_at < ?${projectClause}
                ORDER BY updated_at ASC LIMIT ?
            )
        `), ...params)
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
