import {readPostgresStorageConfig} from './postgres-config.mjs'
import {createPostgresContentStore} from './postgres-content-store.mjs'
import {createPostgresStateStore} from './postgres-state-store.mjs'
import {createMemoryRepository} from './repositories/memory-repository.mjs'
import {createTranscriptRepository} from './repositories/transcript-repository.mjs'
import {createSessionRepository} from './repositories/session-repository.mjs'
import {createProjectRepository} from './repositories/project-repository.mjs'
import {createWorkbenchRepository} from './repositories/workbench-repository.mjs'
import {createTaskEventRepository} from './repositories/task-event-repository.mjs'
import {createPitfallRepository} from './repositories/pitfall-repository.mjs'
import {createImRepository} from './repositories/im-repository.mjs'
import {createWorkflowRepository} from './repositories/workflow-repository.mjs'
import {createNotificationRepository} from './repositories/notification-repository.mjs'
import {createCoordinationRepository} from './repositories/coordination-repository.mjs'

function storageError(message, code, cause = null) {
    return Object.assign(new Error(message), {code, ...(cause ? {cause} : {})})
}

function connectionFailure(error) {
    const code = String(error?.code || '').toUpperCase()
    return ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', '57P01', '57P02', '57P03', '08000', '08001', '08003', '08006', '08007', '08004'].includes(code)
        || /client (?:was )?closed|connection terminated|not queryable/i.test(String(error?.message || ''))
}

async function defaultClientFactory(config) {
    try {
        const {Client} = await import('pg')
        return new Client({connectionString: config.connectionString, connectionTimeoutMillis: 3000})
    } catch (error) {
        throw storageError('PostgreSQL Node 驱动不可用', 'STORAGE_POSTGRES_DRIVER_UNAVAILABLE', error)
    }
}

export class StorageGateway {
    constructor({config, clientFactory = defaultClientFactory, logger = null} = {}) {
        this.config = config || readPostgresStorageConfig()
        this.clientFactory = clientFactory
        this.logger = logger
        this.client = null
        this.mode = 'postgres'
        this.closed = false
        this.content = createPostgresContentStore({gateway: this, schema: this.config.schema})
        this.state = createPostgresStateStore({gateway: this, schema: this.config.schema})
        this.repositories = {
            memory: createMemoryRepository({contentStore: this.content}),
            transcript: createTranscriptRepository({contentStore: this.content}),
        }
    }

    async connect() {
        if (this.closed) throw storageError('StorageGateway 已关闭', 'STORAGE_GATEWAY_CLOSED')
        if (!this.config.enabled) throw storageError('PostgreSQL 主库未启用', 'STORAGE_POSTGRES_NOT_ENABLED')
        if (this.client) return this.client
        const client = await this.clientFactory(this.config)
        try {
            await client.connect()
            this.client = client
            await client.query("SELECT set_config('statement_timeout', $1::text, false)", [String(this.config.statementTimeoutMs)])
            return client
        } catch (error) {
            await client.end?.().catch(() => {})
            throw storageError('PostgreSQL 主库连接失败', 'STORAGE_POSTGRES_CONNECT_FAILED', error)
        }
    }

    async query(text, values = []) {
        if (typeof text !== 'string' || !text.trim()) throw storageError('StorageGateway 查询不能为空', 'STORAGE_QUERY_INVALID')
        const client = await this.connect()
        try {
            return await client.query(text, Array.isArray(values) ? values : [])
        } catch (error) {
            if (String(error?.code || '') === '57014') throw storageError('PostgreSQL 查询超时', 'STORAGE_POSTGRES_TIMEOUT', error)
            if (connectionFailure(error)) {
                if (this.client === client) this.client = null
                await client.end?.().catch(() => {})
                throw storageError('PostgreSQL 连接已断开', 'STORAGE_POSTGRES_DISCONNECTED', error)
            }
            throw error
        }
    }

    async transaction(callback) {
        if (typeof callback !== 'function') throw new TypeError('StorageGateway transaction callback is required')
        const client = await this.connect()
        await client.query('BEGIN')
        try {
            const result = await callback(client)
            await client.query('COMMIT')
            return result
        } catch (error) {
            try { await client.query('ROLLBACK') } catch (rollbackError) { this.logger?.warn?.({err: rollbackError}, 'PostgreSQL 事务回滚失败') }
            throw error
        }
    }

    async health() {
        if (!this.config.enabled) return {mode: this.mode, healthy: false, reason: 'postgres_not_enabled'}
        try {
            const result = await this.query('SELECT current_database() AS database, current_setting($1) AS server_version', ['server_version'])
            return {mode: this.mode, healthy: true, database: result.rows?.[0]?.database || null, serverVersion: result.rows?.[0]?.server_version || null}
        } catch (error) {
            return {mode: this.mode, healthy: false, reason: error.code || 'postgres_unavailable'}
        }
    }

    async close() {
        this.closed = true
        const client = this.client
        this.client = null
        await client?.end?.()
    }

    get db() { return this }

    attachStateRepositories(stateStore) {
        if (!stateStore) throw storageError('PostgreSQL 状态适配器未配置', 'STORAGE_STATE_ADAPTER_REQUIRED')
        this.repositories.session = createSessionRepository({stateStore})
        this.repositories.project = createProjectRepository({stateStore})
        this.repositories.workbench = createWorkbenchRepository({stateStore})
        if (stateStore?.listTaskEvents) this.repositories.taskEvent = createTaskEventRepository({stateStore})
        this.repositories.pitfall = createPitfallRepository({stateStore})
        this.repositories.im = createImRepository({stateStore})
        if (stateStore?.listTaskNotificationIntents && stateStore?.updateTaskNotification
            && stateStore?.summarizeEntries && stateStore?.clearEntries) {
            this.repositories.notification = createNotificationRepository({stateStore})
        }
        if (stateStore?.upsertWorkflowState && stateStore?.listWorkflowStates) {
            this.repositories.workflow = createWorkflowRepository({stateStore})
        }
        if (stateStore?.loadEntries && stateStore?.replaceEntries) {
            this.repositories.coordination = createCoordinationRepository({stateStore})
        }
        return this.repositories
    }
}

export function createStorageGateway(options = {}) {
    return new StorageGateway(options)
}
