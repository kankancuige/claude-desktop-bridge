import {createHash} from 'node:crypto'
import {identifier} from './postgres-schema.mjs'

function required(value, name) {
    const result = String(value || '').trim()
    if (!result || result.length > 512) throw Object.assign(new TypeError(`${name} is required`), {code: 'STORAGE_CONTENT_KEY_INVALID'})
    return result
}

function json(value, fallback = {}) {
    try { return JSON.stringify(value ?? fallback) } catch (error) { throw Object.assign(new TypeError('内容元数据不可序列化'), {code: 'STORAGE_CONTENT_METADATA_INVALID', cause: error}) }
}

function vector(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 4096 || value.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
        throw Object.assign(new TypeError('embedding 向量无效'), {code: 'STORAGE_EMBEDDING_INVALID'})
    }
    return `[${value.map(item => String(Number(item))).join(',')}]`
}

export function contentHash(body) {
    return createHash('sha256').update(String(body || ''), 'utf8').digest('hex')
}

export class PostgresContentStore {
    constructor({gateway, schema = 'bridge'} = {}) {
        if (!gateway?.query) throw new TypeError('StorageGateway is required')
        this.gateway = gateway
        this.table = `${identifier(schema, 'bridge')}.content_documents`
        this.embeddingTable = `${identifier(schema, 'bridge')}.memory_embeddings`
    }

    async put({projectKey, kind, sourceKey, title = null, body = '', bodyHash = contentHash(body), scope = 'project', status = 'active', metadata = {}, updatedAt = Date.now()} = {}) {
        const project = required(projectKey, 'projectKey')
        const contentKind = ['memory', 'markdown', 'transcript', 'event'].includes(kind) ? kind : null
        if (!contentKind) throw Object.assign(new TypeError('content kind invalid'), {code: 'STORAGE_CONTENT_KIND_INVALID'})
        const source = required(sourceKey, 'sourceKey')
        const current = await this.get({projectKey: project, kind: contentKind, sourceKey: source})
        if (current && String(current.bodyHash || '') === String(bodyHash || '')) {
            if (current.body == null && String(body || '')) {
                const repaired = await this.gateway.query(`UPDATE ${this.table} SET body = $4, title = COALESCE($5, title), metadata = $6::jsonb, updated_at = $7 WHERE project_key = $1 AND content_kind = $2 AND source_key = $3 AND version = $8 RETURNING project_key AS "projectKey", content_kind AS kind, source_key AS "sourceKey", title, body, body_hash AS "bodyHash", version, scope, status, metadata, created_at AS "createdAt", updated_at AS "updatedAt"`, [project, contentKind, source, String(body), title == null ? null : String(title).slice(0, 500), json(metadata), Number(updatedAt), Number(current.version)])
                return repaired.rows?.[0] || current
            }
            return current
        }
        const version = Number(current?.version || 0) + 1
        const result = await this.gateway.query(`
            INSERT INTO ${this.table} (project_key, content_kind, source_key, title, body, body_hash, version, scope, status, metadata, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
            RETURNING project_key AS "projectKey", content_kind AS kind, source_key AS "sourceKey", title, body, body_hash AS "bodyHash", version, scope, status, metadata, created_at AS "createdAt", updated_at AS "updatedAt"
        `, [project, contentKind, source, title == null ? null : String(title).slice(0, 500), String(body), String(bodyHash).slice(0, 128), version, String(scope).slice(0, 64), String(status).slice(0, 32), json(metadata), Number(current?.createdAt || updatedAt), Number(updatedAt)])
        return result.rows?.[0] || null
    }

    async get({projectKey, kind, sourceKey} = {}) {
        const project = required(projectKey, 'projectKey')
        const source = required(sourceKey, 'sourceKey')
        const result = await this.gateway.query(`
            SELECT project_key AS "projectKey", content_kind AS kind, source_key AS "sourceKey", title, body, body_hash AS "bodyHash", version, scope, status, metadata, created_at AS "createdAt", updated_at AS "updatedAt"
            FROM ${this.table} WHERE project_key = $1 AND content_kind = $2 AND source_key = $3
            ORDER BY version DESC LIMIT 1
        `, [project, String(kind), source])
        return result.rows?.[0] || null
    }

    async list({projectKey, kind = null, status = 'active', limit = 100, after = null, scope = null} = {}) {
        const project = required(projectKey, 'projectKey')
        const values = [project]
        const clauses = ['project_key = $1']
        if (kind) { values.push(String(kind)); clauses.push(`content_kind = $${values.length}`) }
        if (status !== null) { values.push(String(status)); clauses.push(`status = $${values.length}`) }
        if (scope != null) { values.push(String(scope)); clauses.push(`scope = $${values.length}`) }
        if (after != null) {
            const updatedAt = Number(after.updatedAt)
            const sourceKey = required(after.sourceKey, 'after.sourceKey')
            if (!Number.isFinite(updatedAt)) throw Object.assign(new TypeError('after.updatedAt is invalid'), {code: 'STORAGE_CONTENT_CURSOR_INVALID'})
            values.push(updatedAt, sourceKey)
            clauses.push(`(updated_at, source_key) < ($${values.length - 1}, $${values.length})`)
        }
        values.push(Math.max(1, Math.min(500, Number(limit) || 100)))
        const result = await this.gateway.query(`
            SELECT project_key AS "projectKey", content_kind AS kind, source_key AS "sourceKey", title, body, body_hash AS "bodyHash", version, scope, status, metadata, created_at AS "createdAt", updated_at AS "updatedAt"
            FROM ${this.table} WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC LIMIT $${values.length}
        `, values)
        return result.rows || []
    }

    async getEmbedding({projectKey, sourceKey, bodyHash, embeddingModel} = {}) {
        const result = await this.gateway.query(`
            SELECT project_key AS "projectKey", source_key AS "sourceKey", body_hash AS "bodyHash", embedding_model AS "embeddingModel", dimensions, status, updated_at AS "updatedAt"
            FROM ${this.embeddingTable}
            WHERE project_key = $1 AND source_key = $2 AND body_hash = $3 AND embedding_model = $4
            LIMIT 1
        `, [required(projectKey, 'projectKey'), required(sourceKey, 'sourceKey'), required(bodyHash, 'bodyHash'), required(embeddingModel, 'embeddingModel')])
        return result.rows?.[0] || null
    }

    async disable({projectKey, kind, sourceKey, updatedAt = Date.now()} = {}) {
        const project = required(projectKey, 'projectKey')
        const source = required(sourceKey, 'sourceKey')
        const result = await this.gateway.query(`UPDATE ${this.table} SET status = 'disabled', updated_at = $4 WHERE project_key = $1 AND content_kind = $2 AND source_key = $3 AND version = (SELECT MAX(version) FROM ${this.table} WHERE project_key = $1 AND content_kind = $2 AND source_key = $3)`, [project, String(kind), source, Number(updatedAt)])
        return Number(result.rowCount || 0) > 0
    }

    async remove({projectKey, kind, sourceKey} = {}) {
        const result = await this.gateway.query(`DELETE FROM ${this.table} WHERE project_key = $1 AND content_kind = $2 AND source_key = $3`, [required(projectKey, 'projectKey'), String(kind), required(sourceKey, 'sourceKey')])
        return Number(result.rowCount || 0) > 0
    }

    async markUsed({projectKey, kind, sourceKey, usedAt = Date.now()} = {}) {
        const project = required(projectKey, 'projectKey')
        const source = required(sourceKey, 'sourceKey')
        const result = await this.gateway.query(`UPDATE ${this.table}
            SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{lastUsedAt}', to_jsonb($4::bigint)), updated_at = $4
            WHERE project_key = $1 AND content_kind = $2 AND source_key = $3
              AND version = (SELECT MAX(version) FROM ${this.table} WHERE project_key = $1 AND content_kind = $2 AND source_key = $3)`,
        [project, String(kind), source, Number(usedAt)])
        return Number(result.rowCount || 0) > 0
    }

    async putEmbedding({projectKey, sourceKey, bodyHash, embeddingModel, embedding, status = 'ready', updatedAt = Date.now()} = {}) {
        const project = required(projectKey, 'projectKey')
        const source = required(sourceKey, 'sourceKey')
        const hash = required(bodyHash, 'bodyHash')
        const model = required(embeddingModel, 'embeddingModel')
        const values = vector(embedding)
        const result = await this.gateway.query(`
            INSERT INTO ${this.embeddingTable} (project_key, source_key, body_hash, embedding_model, dimensions, embedding_json, embedding, status, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::vector, $8, $9)
            ON CONFLICT (project_key, source_key, body_hash, embedding_model) DO UPDATE SET dimensions = EXCLUDED.dimensions, embedding_json = EXCLUDED.embedding_json, embedding = EXCLUDED.embedding, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
            RETURNING project_key AS "projectKey", source_key AS "sourceKey", body_hash AS "bodyHash", embedding_model AS "embeddingModel", dimensions, status, updated_at AS "updatedAt"
        `, [project, source, hash, model, embedding.length, JSON.stringify(embedding), values, String(status).slice(0, 32), Number(updatedAt)])
        return result.rows?.[0] || null
    }

    async searchSimilar({projectKey, embeddingModel, embedding, limit = 10, scope = null} = {}) {
        const project = required(projectKey, 'projectKey')
        const model = required(embeddingModel, 'embeddingModel')
        const embeddingValue = vector(embedding)
        const safeLimit = Math.max(1, Math.min(100, Number(limit) || 10))
        const values = [project, embeddingValue, model]
        const scopeClause = scope == null ? '' : ' AND c.scope = $4'
        if (scope != null) values.push(String(scope))
        values.push(safeLimit)
        const limitPlaceholder = scope == null ? '$4' : '$5'
        const result = await this.gateway.query(`
            SELECT e.project_key AS "projectKey", e.source_key AS "sourceKey", e.body_hash AS "bodyHash", e.embedding_model AS "embeddingModel", e.status,
                c.title, c.body, c.metadata, (1 - (e.embedding <=> $2::vector)) AS similarity
            FROM ${this.embeddingTable} e
            JOIN ${this.table} c ON c.project_key = e.project_key AND c.content_kind = 'memory' AND c.source_key = e.source_key
                AND c.version = (SELECT MAX(c2.version) FROM ${this.table} c2 WHERE c2.project_key = e.project_key AND c2.content_kind = 'memory' AND c2.source_key = e.source_key)
            WHERE e.project_key = $1 AND e.embedding_model = $3 AND e.status = 'ready' AND c.status = 'active'${scopeClause}
            ORDER BY e.embedding <=> $2::vector LIMIT ${limitPlaceholder}
        `, values)
        return result.rows || []
    }

    async removeEmbedding({projectKey, sourceKey, bodyHash = null, embeddingModel = null} = {}) {
        const values = [required(projectKey, 'projectKey'), required(sourceKey, 'sourceKey')]
        const clauses = ['project_key = $1', 'source_key = $2']
        if (bodyHash) { values.push(String(bodyHash)); clauses.push(`body_hash = $${values.length}`) }
        if (embeddingModel) { values.push(String(embeddingModel)); clauses.push(`embedding_model = $${values.length}`) }
        const result = await this.gateway.query(`DELETE FROM ${this.embeddingTable} WHERE ${clauses.join(' AND ')}`, values)
        return Number(result.rowCount || 0) > 0
    }
}

export function createPostgresContentStore(options = {}) {
    return new PostgresContentStore(options)
}
