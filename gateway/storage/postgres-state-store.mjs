import {identifier} from './postgres-schema.mjs'

function required(value, name, max = 240) {
    const result = String(value || '').trim()
    if (!result || result.length > max || /[\0\r\n]/.test(result)) throw Object.assign(new TypeError(`${name} 无效`), {code: 'STORAGE_STATE_KEY_INVALID'})
    return result
}

function safeJson(value, fallback = {}) {
    try { return JSON.stringify(value ?? fallback) } catch (error) {
        throw Object.assign(new TypeError('PostgreSQL 状态值不可序列化'), {code: 'STORAGE_STATE_SERIALIZATION_FAILED', cause: error})
    }
}

function token(value, fallback = null) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback
}

export class PostgresStateStore {
    constructor({gateway, schema = 'bridge'} = {}) {
        if (!gateway?.query) throw new TypeError('StorageGateway is required')
        this.gateway = gateway
        this.entriesTable = `${identifier(schema, 'bridge')}.state_entries`
        this.usageTable = `${identifier(schema, 'bridge')}.model_usage_events`
        this.taskTable = `${identifier(schema, 'bridge')}.task_state`
        this.taskEventsTable = `${identifier(schema, 'bridge')}.task_events`
    }

    async loadEntries(kind, platform) {
        const stateKind = required(kind, 'kind', 32)
        const statePlatform = required(platform, 'platform', 32)
        const result = await this.gateway.query(`SELECT entry_id AS "entryId", data_json AS data FROM ${this.entriesTable} WHERE kind = $1 AND platform = $2 ORDER BY updated_at DESC LIMIT $3`, [stateKind, statePlatform, 10000])
        return (result.rows || []).map(row => [row.entryId, row.data]).filter(([, value]) => value && typeof value === 'object')
    }

    async replaceEntries(kind, platform, entries) {
        const stateKind = required(kind, 'kind', 32)
        const statePlatform = required(platform, 'platform', 32)
        const source = entries instanceof Map ? [...entries.entries()] : Object.entries(entries || {})
        await this.gateway.transaction(async client => {
            await client.query(`DELETE FROM ${this.entriesTable} WHERE kind = $1 AND platform = $2`, [stateKind, statePlatform])
            for (const [entryId, value] of source.slice(0, 10000)) {
                const id = required(entryId, 'entryId')
                const data = value && typeof value === 'object' ? value : {}
                await client.query(`INSERT INTO ${this.entriesTable} (kind, platform, entry_id, state, updated_at, next_attempt_at, attempts, payload, data_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [stateKind, statePlatform, id, typeof data.state === 'string' ? data.state.slice(0, 32) : null, token(data.updatedAt, Date.now()), token(data.nextAttemptAt), token(data.attempts, 0), typeof data.payload === 'string' ? data.payload : null, safeJson(data)])
            }
        })
        return true
    }

    async appendModelUsageEvent(event = {}) {
        const eventId = required(event.eventId, 'eventId')
        const source = ['provider_observed', 'partial', 'unknown'].includes(event.source) ? event.source : 'unknown'
        const result = await this.gateway.query(`INSERT INTO ${this.usageTable} (event_id, project_key, session_id, model, provider_key, context_fingerprint, policy, cache_eligibility, reason_codes, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, usage_source, duration_ms, retry_count, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (event_id) DO NOTHING`, [eventId, event.projectKey ? String(event.projectKey).slice(0, 240) : null, event.sessionId ? String(event.sessionId).slice(0, 240) : null, event.model ? String(event.model).slice(0, 240) : null, event.providerKey ? String(event.providerKey).slice(0, 96) : null, event.contextFingerprint ? String(event.contextFingerprint).slice(0, 96) : null, event.policy ? String(event.policy).slice(0, 64) : null, event.cacheEligibility ? String(event.cacheEligibility).slice(0, 64) : null, safeJson(Array.isArray(event.reasonCodes) ? event.reasonCodes.slice(0, 12) : []), token(event.inputTokens), token(event.outputTokens), token(event.cacheReadInputTokens), token(event.cacheCreationInputTokens), source, token(event.durationMs), token(event.retryCount, 0), token(event.createdAt, Date.now())])
        return Number(result.rowCount || 0) > 0
    }

    async recordTaskTransition(record = {}) {
        const projectKey = required(record.projectKey, 'projectKey')
        const taskKey = required(record.taskKey, 'taskKey')
        const state = record.state && typeof record.state === 'object' ? record.state : {}
        const revision = token(record.revision, token(record.sequence, 1))
        const updatedAt = token(record.updatedAt, Date.now())
        return this.gateway.transaction(async client => {
            const current = await client.query(`SELECT revision FROM ${this.taskTable} WHERE project_key = $1 AND task_key = $2 FOR UPDATE`, [projectKey, taskKey])
            const currentRevision = Number(current.rows?.[0]?.revision || 0)
            if (currentRevision >= revision) return false
            await client.query(`INSERT INTO ${this.taskTable} (project_key, task_key, session_id, task_id, sdk_session_id, status, phase, model_tier, sequence, revision, started_at, completed_at, updated_at, notifications, state_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb) ON CONFLICT (project_key, task_key) DO UPDATE SET session_id = EXCLUDED.session_id, task_id = EXCLUDED.task_id, sdk_session_id = EXCLUDED.sdk_session_id, status = EXCLUDED.status, phase = EXCLUDED.phase, model_tier = EXCLUDED.model_tier, sequence = EXCLUDED.sequence, revision = EXCLUDED.revision, started_at = EXCLUDED.started_at, completed_at = EXCLUDED.completed_at, updated_at = EXCLUDED.updated_at, notifications = EXCLUDED.notifications, state_json = EXCLUDED.state_json`, [projectKey, taskKey, record.sessionId || null, record.taskId || null, record.sdkSessionId || null, String(record.status || 'accepted').slice(0, 64), String(record.phase || record.status || 'accepted').slice(0, 64), record.modelTier ? String(record.modelTier).slice(0, 64) : null, token(record.sequence, 0), revision, token(record.startedAt), token(record.completedAt), updatedAt, safeJson(record.notifications || state.notifications || {}), safeJson(state)])
            await client.query(`INSERT INTO ${this.taskEventsTable} (project_key, task_key, revision, event_type, event_json, created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING`, [projectKey, taskKey, token(record.eventRevision, revision), String(record.eventType || 'task/state-changed').slice(0, 120), safeJson(record.eventPayload || state), updatedAt])
            return true
        })
    }

    async appendTaskEvent(record = {}) {
        const projectKey = required(record.projectKey, 'projectKey')
        const taskKey = required(record.taskKey || record.taskId, 'taskKey')
        const revision = token(record.eventRevision, token(record.revision, 1))
        const createdAt = token(record.createdAt, Date.now())
        const result = await this.gateway.query(`INSERT INTO ${this.taskEventsTable} (project_key, task_key, revision, event_type, event_json, created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING`, [projectKey, taskKey, revision, String(record.eventType || 'task/event').slice(0, 120), safeJson(record.eventPayload || record.payload || {}), createdAt])
        return Number(result.rowCount || 0) > 0
    }

    async getTaskState(projectKey, taskKey) {
        const result = await this.gateway.query(`SELECT project_key AS "projectKey", task_key AS "taskKey", session_id AS "sessionId", task_id AS "taskId", sdk_session_id AS "sdkSessionId", status, outcome, continuation_reason AS "continuationReason", phase, model_tier AS "modelTier", sequence, revision, started_at AS "startedAt", completed_at AS "completedAt", updated_at AS "updatedAt", notifications, state_json AS state FROM ${this.taskTable} WHERE project_key = $1 AND (task_key = $2 OR task_id = $2 OR sdk_session_id = $2 OR session_id = $2) ORDER BY revision DESC LIMIT 1`, [required(projectKey, 'projectKey'), required(taskKey, 'taskKey')])
        return result.rows?.[0] || null
    }

    async listTaskStates(projectKey = null, {activeOnly = false, limit = 100} = {}) {
        const values = []
        const where = []
        if (projectKey) { values.push(required(projectKey, 'projectKey')); where.push(`project_key = $${values.length}`) }
        if (activeOnly) { where.push(`status IN ('running','reviewing','changes_required','fixing','accepted')`) }
        values.push(Math.max(1, Math.min(500, Number(limit) || 100)))
        const result = await this.gateway.query(`SELECT project_key AS "projectKey", task_key AS "taskKey", session_id AS "sessionId", task_id AS "taskId", sdk_session_id AS "sdkSessionId", status, outcome, continuation_reason AS "continuationReason", phase, model_tier AS "modelTier", sequence, revision, started_at AS "startedAt", completed_at AS "completedAt", updated_at AS "updatedAt", notifications, state_json AS state FROM ${this.taskTable}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT $${values.length}`, values)
        return result.rows || []
    }

    async listTaskEvents({projectKey, taskId, limit = 100, before = null, after = null, eventType = null} = {}) {
        const values = [required(projectKey, 'projectKey'), required(taskId, 'taskId')]
        const where = ['project_key = $1', '(task_key = $2 OR task_key = $3)']
        values.push(`${taskId}:coordinator`)
        if (before != null) { values.push(Number(before)); where.push(`revision < $${values.length}`) }
        if (after != null) { values.push(Number(after)); where.push(`revision > $${values.length}`) }
        if (eventType) { values.push(String(eventType).slice(0, 120)); where.push(`event_type = $${values.length}`) }
        values.push(Math.max(1, Math.min(500, Number(limit) || 100)))
        const result = await this.gateway.query(`SELECT project_key AS "projectKey", task_key AS "taskKey", revision, event_type AS "eventType", event_json AS payload, created_at AS "createdAt" FROM ${this.taskEventsTable} WHERE ${where.join(' AND ')} ORDER BY revision ASC LIMIT $${values.length}`, values)
        return result.rows || []
    }

    async listModelUsageEvents(sessionId, {limit = 100} = {}) {
        const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100))
        const result = await this.gateway.query(`SELECT event_id AS "eventId", project_key AS "projectKey", session_id AS "sessionId", model, provider_key AS "providerKey", context_fingerprint AS "contextFingerprint", policy, cache_eligibility AS "cacheEligibility", reason_codes AS "reasonCodes", input_tokens AS "inputTokens", output_tokens AS "outputTokens", cache_read_input_tokens AS "cacheReadInputTokens", cache_creation_input_tokens AS "cacheCreationInputTokens", usage_source AS source, duration_ms AS "durationMs", retry_count AS "retryCount", created_at AS "createdAt" FROM ${this.usageTable} WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2`, [required(sessionId, 'sessionId'), safeLimit])
        return result.rows || []
    }
}

export function createPostgresStateStore(options = {}) { return new PostgresStateStore(options) }
