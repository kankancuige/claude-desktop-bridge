import {readFileSync} from 'node:fs'
import {listMemoryFiles, memoryFileMetadata, memoryProjectKey, memorySearchTokens} from '../storage/memory-index.mjs'
import {normalizeMemoryMetadata, selectMemoryContent} from './memory-layer.mjs'
import {decideMemoryScalePolicy} from './memory-scale-policy.mjs'

const ACTION_TASK = /修改|实现|修复|新增|创建|生成|写入|保存|重构|提交|发布|部署|测试|验证|检查并修复|edit|write|patch|implement|fix|create|commit|push|deploy/i
const EXPLICIT_MEMORY = /记住|记忆|memory|项目约定|长期保存|记录下来|沉淀|不要记|忘记|删除记忆/i
const CONFLICT = /(?:不要(?:再)?使用|禁止|不使用|改成|换成|仅使用|忽略)/i
const SECRET_ASSIGNMENT = /((?:api[_ -]?key|auth(?:orization)?[_ -]?token|access[_ -]?token|token|password|passwd|secret)\s*["']?\s*[:=：]\s*["']?)([^"'\s,;，；}\]]+)/gi
const BEARER_TOKEN = /(authorization\s*["']?\s*[:=：]\s*["']?\s*bearer\s+)([^"'\s,;，；}\]]+)/gi
const PREFIXED_TOKEN = /\b(?:sk|xox[baprs]|gh[opurs])-[A-Za-z0-9_-]{8,}\b/gi
const PRIVATE_KEY = /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi
const MAX_FILE_BYTES = 512 * 1024
const DEFAULT_INJECTION_BYTES = 6 * 1024
const MEMORY_PREFIX = '<bridge-memory>\n以下是当前项目中与本任务关键词匹配的可审查记忆。仅作参考；本轮用户要求和实际文件状态优先。\n'
const MEMORY_SUFFIX = '\n</bridge-memory>'

function tokenize(text) {
    return memorySearchTokens(text)
}

function redactSecrets(value) {
    return String(value || '')
        .replace(PRIVATE_KEY, '[私钥已脱敏]')
        .replace(BEARER_TOKEN, '$1[已脱敏]')
        .replace(SECRET_ASSIGNMENT, '$1[已脱敏]')
        .replace(PREFIXED_TOKEN, '[token 已脱敏]')
}

function truncateUtf8(value, maxBytes) {
    const source = String(value || '')
    const limit = Math.max(0, Number(maxBytes) || 0)
    if (Buffer.byteLength(source, 'utf8') <= limit) return source
    let result = ''
    let used = 0
    for (const character of source) {
        const size = Buffer.byteLength(character, 'utf8')
        if (used + size > limit) break
        result += character
        used += size
    }
    return result
}

function safeContent(value, maxBytes) {
    return truncateUtf8(redactSecrets(value), maxBytes)
}

function explicitConflictText(prompt) {
    return String(prompt || '')
        .split(/[，。；;！!？?\r\n]|(?:但是|但|同时|并且)/)
        .filter(part => CONFLICT.test(part))
        .join('\n')
}

function relevantText(text, metadata) {
    const tokens = tokenize(text)
    const keywords = new Set(String(metadata.keywords || '').split(',').filter(Boolean))
    return tokens.filter(token => keywords.has(token)).length
}

function normalizeSourcePath(value) {
    const sourcePath = String(value || '').replace(/\\/g, '/')
    return /^memory\/[A-Za-z0-9._-]{1,160}\.md$/i.test(sourcePath) ? sourcePath : null
}

function memoryScopeMatches(row, {scope = 'project', agentType = '', taskId = ''} = {}) {
    const rowScope = String(row?.scope || 'project').toLowerCase()
    if (rowScope === 'global') return true
    if (rowScope === 'project') return scope === 'project' || scope === 'global'
    if (rowScope === 'agent') return scope === 'agent' && String(row?.metadata?.agentType || '') === String(agentType || '')
    if (rowScope === 'task') return scope === 'task' && String(row?.metadata?.taskId || '') === String(taskId || '')
    return false
}

function memoryTrace(scored = [], selected = new Set()) {
    return scored.slice(0, 50).map(({row, score}) => {
        const sourceKey = String(row?.sourceKey || row?.sourcePath || '').slice(0, 240)
        return {sourceKey, scope: String(row?.scope || 'project').slice(0, 32), score: Number.isFinite(Number(score)) ? Number(score) : null, selected: selected.has(sourceKey), reason: selected.has(sourceKey) ? 'selected' : 'budget_or_limit'}
    })
}

function preserveDatabaseMemory(row) {
    return row?.status === 'candidate' || row?.metadata?.lifecycle === 'active' && row?.metadata?.approvedBy
}

export class BridgeMemoryService {
    constructor({bridgeHome, memoryRepository = null, embeddingProvider = null, vectorEnabled = false, maxBytes = DEFAULT_INJECTION_BYTES, maxChars = null, now = () => Date.now(), logger = null, backend = null, postgresConfig = null, semanticModeGate = null, vectorHealth = null, embeddingDimensions = null} = {}) {
        if (!bridgeHome) throw new TypeError('bridgeHome is required')
        if (!memoryRepository?.list || !memoryRepository?.get || !memoryRepository?.put || !memoryRepository?.disable || !memoryRepository?.remove || !memoryRepository?.markUsed) {
            throw Object.assign(new TypeError('Memory Repository is required'), {code: 'MEMORY_REPOSITORY_REQUIRED'})
        }
        this.bridgeHome = bridgeHome
        this.memoryRepository = memoryRepository
        this.embeddingProvider = embeddingProvider?.embed && typeof embeddingProvider.embed === 'function' ? embeddingProvider : null
        this.vectorEnabled = vectorEnabled === true && Boolean(this.embeddingProvider) && typeof this.memoryRepository?.putEmbedding === 'function'
        this.semanticModeGate = typeof semanticModeGate === 'function' ? semanticModeGate : null
        this.vectorHealth = vectorHealth || {healthy: this.vectorEnabled, enabled: this.vectorEnabled}
        this.embeddingDimensions = Number(embeddingDimensions || this.embeddingProvider?.dimensions || 0)
        const configuredBudget = maxChars ?? maxBytes
        this.maxBytes = Math.max(512, Math.min(32 * 1024, Number(configuredBudget) || DEFAULT_INJECTION_BYTES))
        this.now = now
        this.logger = logger
        this.backend = backend || {mode: this.vectorEnabled ? 'postgres-pgvector' : 'postgres', effectiveMode: this.vectorEnabled ? 'postgres-pgvector' : 'postgres'}
        this.backendMode = this.backend.effectiveMode || this.backend.mode
    }

    refreshProject({workDir, encodedDir = memoryProjectKey(workDir)} = {}) {
        if (!workDir || !encodedDir) return {indexed: 0, removed: 0, mode: 'postgres', backend: this.backendMode}
        const key = String(encodedDir)
        const files = listMemoryFiles({bridgeHome: this.bridgeHome, encodedDir: key})
        const current = new Set()
        const knownRows = this.memoryRepository.list({projectKey: key, status: null, limit: 500})
        if (knownRows?.then) throw Object.assign(new Error('同步 Memory 操作需要同步 Repository port'), {code: 'MEMORY_SYNC_PORT_REQUIRED'})
        const known = new Map(knownRows.map(item => [item.sourceKey || item.sourcePath, item]))
        let indexed = 0
        for (const file of files) {
            try {
                const metadata = memoryFileMetadata({projectKey: key, sourcePath: file.sourcePath, filePath: file.filePath, now: this.now()})
                const body = readFileSync(file.filePath, 'utf8')
                const previous = known.get(file.sourcePath)
                const status = previous?.status === 'disabled' && (previous.bodyHash || previous.contentHash) === metadata.contentHash ? 'disabled' : 'active'
                const result = this.memoryRepository.put({
                    projectKey: key, sourceKey: metadata.sourcePath, title: metadata.title, body,
                    bodyHash: metadata.contentHash, scope: metadata.scope || 'project', status,
                    metadata: normalizeMemoryMetadata({keywords: metadata.keywords, mtime: metadata.mtime, size: metadata.size, confidence: metadata.confidence ?? 1, lastVerifiedAt: metadata.lastVerifiedAt || null}, body),
                    updatedAt: this.now(),
                })
                if (result?.then) throw Object.assign(new Error('同步 Memory 写入需要同步 Repository port'), {code: 'MEMORY_SYNC_PORT_REQUIRED'})
                current.add(file.sourcePath)
                indexed++
            } catch (error) {
                this.logger?.warn?.({err: error, projectKey: key, sourcePath: file.sourcePath}, 'Memory 文件索引失败')
            }
        }
        const old = this.memoryRepository.list({projectKey: key, status: null, limit: 500})
        if (old?.then) throw Object.assign(new Error('同步 Memory 读取需要同步 Repository port'), {code: 'MEMORY_SYNC_PORT_REQUIRED'})
        let removed = 0
        for (const item of old) {
            const sourceKey = item.sourceKey || item.sourcePath
            if (!current.has(sourceKey) && !preserveDatabaseMemory(item)) {
                const result = this.memoryRepository.remove({projectKey: key, sourceKey})
                if (result?.then) throw Object.assign(new Error('同步 Memory 删除需要同步 Repository port'), {code: 'MEMORY_SYNC_PORT_REQUIRED'})
                removed++
            }
        }
        return {indexed, removed, mode: 'postgres', backend: this.backendMode}
    }

    retrieve({workDir, encodedDir = memoryProjectKey(workDir), text, maxBytes = this.maxBytes, maxChars = null, scope = 'project', agentType = '', taskId = ''} = {}) {
        const prompt = String(text || '').trim()
        if (!workDir || !prompt || (!ACTION_TASK.test(prompt) && !EXPLICIT_MEMORY.test(prompt)) || /(?:不要|禁止|别|不需要).{0,8}(?:记住|记忆|memory|记录)/i.test(prompt)) {
            return {text: '', items: [], reason: 'not_relevant', backend: this.backendMode}
        }
        const key = String(encodedDir)
        let rows = []
        this.refreshProject({workDir, encodedDir: key})
        rows = (this.memoryRepository.list({projectKey: key, status: 'active', limit: 200}) || []).filter(row => memoryScopeMatches(row, {scope, agentType, taskId}))
        if (rows?.then) throw Object.assign(new Error('同步 Memory 读取需要同步 Repository port'), {code: 'MEMORY_SYNC_PORT_REQUIRED'})
        const conflicts = explicitConflictText(prompt)
        const scored = rows
            .map(row => ({row, score: relevantText(prompt, row)}))
            .filter(item => item.score > 0
                && item.row.status === 'active'
                && (!conflicts || relevantText(conflicts, item.row) === 0)
                && (!Number.isFinite(item.row.expiresAt) || Number(item.row.expiresAt) > this.now()))
            .sort((a, b) => b.score - a.score || Number(b.row.updatedAt) - Number(a.row.updatedAt))
        const parts = []
        const items = []
        const selectedKeys = new Set()
        const configuredBudget = maxChars ?? maxBytes
        const budget = Math.max(512, Math.min(32 * 1024, Number(configuredBudget) || this.maxBytes))
        let remaining = budget - Buffer.byteLength(MEMORY_PREFIX + MEMORY_SUFFIX, 'utf8')
        for (const {row, score} of scored) {
            const sourcePath = String(row.sourceKey || row.sourcePath || '')
            if (!normalizeSourcePath(sourcePath)) continue
            try {
                const content = typeof row.body === 'string'
                    ? row.body
                    : ''
                if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) continue
                const separator = parts.length ? '\n\n' : ''
                const metadata = `来源: ${sourcePath}\n标题: ${row.title}\n`
                const fixedBytes = Buffer.byteLength(separator + metadata, 'utf8')
                const snippetBudget = Math.min(2048, remaining - fixedBytes)
                if (snippetBudget < 96) break
                const snippet = safeContent(content, snippetBudget)
                if (!snippet) continue
                parts.push(`${metadata}${snippet}`)
                items.push({sourcePath, title: row.title, score, lastVerifiedAt: row.lastVerifiedAt || null})
                selectedKeys.add(sourcePath)
                const result = this.memoryRepository.markUsed({projectKey: key, sourceKey: sourcePath, usedAt: this.now()})
                if (result?.then) throw Object.assign(new Error('同步 Memory 标记使用需要同步 Repository port'), {code: 'MEMORY_SYNC_PORT_REQUIRED'})
                remaining -= fixedBytes + Buffer.byteLength(snippet, 'utf8')
            } catch (error) {
                this.logger?.debug?.({err: error, sourcePath: row.sourcePath}, '读取 Memory 内容失败')
            }
        }
        if (!parts.length) return {text: '', items, trace: memoryTrace(scored, selectedKeys), reason: 'no_match', backend: this.backendMode}
        return {
            text: `${MEMORY_PREFIX}${parts.join('\n\n')}${MEMORY_SUFFIX}`,
            items,
            trace: memoryTrace(scored, selectedKeys),
            reason: 'matched',
            backend: this.backendMode,
        }
    }

    async refreshProjectAsync({workDir, encodedDir = memoryProjectKey(workDir)} = {}) {
        if (!workDir || !encodedDir) return {indexed: 0, removed: 0, mode: 'postgres', backend: this.backendMode}
        const key = String(encodedDir)
        const files = listMemoryFiles({bridgeHome: this.bridgeHome, encodedDir: key})
        const known = new Map((await this.memoryRepository.list({projectKey: key, status: null, limit: 500})).map(item => [item.sourceKey, item]))
        const semantic = this.#semanticDecision(String(encodedDir))
        let indexed = 0
        for (const file of files) {
            try {
                const metadata = memoryFileMetadata({projectKey: String(encodedDir), sourcePath: file.sourcePath, filePath: file.filePath, now: this.now()})
                const content = readFileSync(file.filePath, 'utf8')
                const previous = known.get(metadata.sourcePath)
                const status = previous?.status === 'disabled' && (previous.bodyHash || previous.contentHash) === metadata.contentHash ? 'disabled' : 'active'
                await this.memoryRepository.put({
                    projectKey: key, sourceKey: metadata.sourcePath,
                    title: metadata.title, body: content, bodyHash: metadata.contentHash,
                    scope: metadata.scope || 'project', status,
                    metadata: normalizeMemoryMetadata({keywords: metadata.keywords, mtime: metadata.mtime, size: metadata.size, confidence: metadata.confidence ?? 1, lastVerifiedAt: metadata.lastVerifiedAt || null}, content),
                    updatedAt: metadata.lastVerifiedAt || this.now(),
                })
                if (semantic.enabled) {
                    try {
                        const embedding = await this.embeddingProvider.embed(content)
                        await this.memoryRepository.putEmbedding({
                            projectKey: String(encodedDir), sourceKey: metadata.sourcePath, bodyHash: metadata.contentHash,
                            embeddingModel: this.embeddingProvider.name, embedding,
                        })
                    } catch (error) {
                        this.logger?.warn?.({code: error?.code || 'EMBEDDING_FAILED', projectKey: String(encodedDir), sourcePath: file.sourcePath}, 'Memory embedding 生成失败，保留关键词索引')
                    }
                }
                indexed++
            } catch (error) {
                this.logger?.warn?.({err: error, projectKey: String(encodedDir), sourcePath: file.sourcePath}, 'PostgreSQL Memory 内容同步失败')
            }
        }
        return {indexed, removed: 0, mode: 'postgres', backend: semantic.enabled ? 'postgres-pgvector' : 'postgres', semanticEnabled: semantic.enabled, semanticDisabledReason: semantic.reason}
    }

    async retrieveAsync({workDir, encodedDir = memoryProjectKey(workDir), text, maxBytes = this.maxBytes, maxChars = null, scope = 'project', agentType = '', taskId = ''} = {}) {
        const prompt = String(text || '').trim()
        if (!workDir || !prompt || (!ACTION_TASK.test(prompt) && !EXPLICIT_MEMORY.test(prompt)) || /(?:不要|禁止|别|不需要).{0,8}(?:记住|记忆|memory|记录)/i.test(prompt)) return {text: '', items: [], reason: 'not_relevant', backend: 'postgres'}
        const semantic = this.#semanticDecision(String(encodedDir))
        await this.refreshProjectAsync({workDir, encodedDir})
        const conflicts = explicitConflictText(prompt)
        if (semantic.enabled) {
            try {
                const embedding = await this.embeddingProvider.embed(prompt)
                const semanticRows = (await this.memoryRepository.searchSimilar({projectKey: String(encodedDir), embeddingModel: this.embeddingProvider.name, embedding, limit: 20})).filter(row => memoryScopeMatches(row, {scope, agentType, taskId}))
                const semanticMatches = semanticRows
                    .filter(row => Number(row.similarity) > 0 && (!conflicts || relevantText(conflicts, {keywords: row.metadata?.keywords || ''}) === 0))
                    .map(row => ({row, score: Number(row.similarity)}))
                if (semanticMatches.length) return this.#buildPostgresMemoryResult(semanticMatches, maxBytes, maxChars, {semanticEnabled: true})
            } catch (error) {
                this.logger?.warn?.({code: error?.code || 'EMBEDDING_RETRIEVAL_FAILED', projectKey: String(encodedDir)}, 'Memory 语义召回失败，回退关键词召回')
            }
        }
        const rows = (await this.memoryRepository.list({projectKey: String(encodedDir), status: 'active', limit: 200})).filter(row => memoryScopeMatches(row, {scope, agentType, taskId}))
        const scored = rows.map(row => ({row, score: relevantText(prompt, {keywords: row.metadata?.keywords || ''})}))
            .filter(item => item.score > 0 && (!conflicts || relevantText(conflicts, {keywords: item.row.metadata?.keywords || ''}) === 0))
            .sort((a, b) => b.score - a.score || Number(b.row.updatedAt) - Number(a.row.updatedAt))
        return this.#buildPostgresMemoryResult(scored, maxBytes, maxChars, {semanticEnabled: semantic.enabled, semanticDisabledReason: semantic.reason})
    }

    #semanticDecision(projectKey) {
        if (!this.semanticModeGate) return {enabled: this.vectorEnabled, reason: this.vectorEnabled ? null : 'vector_unavailable'}
        try {
            const decision = this.semanticModeGate({
                projectKey,
                embeddingModel: this.embeddingProvider?.name || '',
                dimensions: this.embeddingDimensions,
                vectorHealth: this.vectorHealth,
            })
            return {enabled: decision?.enabled === true, reason: decision?.reason || (decision?.enabled ? null : 'semantic_disabled')}
        } catch (error) {
            this.logger?.warn?.({code: error?.code || 'MEMORY_SEMANTIC_GATE_FAILED', projectKey}, 'Memory 语义门禁评估失败，回退关键词召回')
            return {enabled: false, reason: 'semantic_gate_error'}
        }
    }

    #buildPostgresMemoryResult(scored, maxBytes, maxChars, {semanticEnabled = this.vectorEnabled, semanticDisabledReason = null} = {}) {
        const configuredBudget = maxChars ?? maxBytes
        const budget = Math.max(512, Math.min(32 * 1024, Number(configuredBudget) || this.maxBytes))
        let remaining = budget - Buffer.byteLength(MEMORY_PREFIX + MEMORY_SUFFIX, 'utf8')
        const parts = []
        const items = []
        const selectedKeys = new Set()
        for (const {row, score} of scored) {
            const sourcePath = normalizeSourcePath(row.sourceKey)
            if (!sourcePath || typeof row.body !== 'string') continue
            const metadata = `来源: ${sourcePath}\n标题: ${row.title || sourcePath}\n`
            const fixedBytes = Buffer.byteLength(`${parts.length ? '\n\n' : ''}${metadata}`, 'utf8')
            const snippetBudget = Math.min(2048, remaining - fixedBytes)
            if (snippetBudget < 96) break
            const snippet = safeContent(row.body, snippetBudget)
            if (!snippet) continue
            parts.push(`${metadata}${snippet}`)
            items.push({sourcePath, title: row.title || sourcePath, score, lastVerifiedAt: row.metadata?.lastVerifiedAt || null})
            selectedKeys.add(row.sourceKey)
            remaining -= fixedBytes + Buffer.byteLength(snippet, 'utf8')
        }
        if (!parts.length) return {text: '', items, trace: memoryTrace(scored, selectedKeys), reason: 'no_match', backend: semanticEnabled ? 'postgres-pgvector' : 'postgres', semanticDisabledReason}
        return {text: `${MEMORY_PREFIX}${parts.join('\n\n')}${MEMORY_SUFFIX}`, items, trace: memoryTrace(scored, selectedKeys), reason: 'matched', backend: semanticEnabled ? 'postgres-pgvector' : 'postgres', semanticDisabledReason}
    }

    list({encodedDir, status = null, query = '', limit = 200} = {}) {
        const rows = this.memoryRepository.list({projectKey: String(encodedDir || ''), status, limit: 500}) || []
        if (rows?.then) throw Object.assign(new Error('同步 Memory 列表需要同步 Repository port'), {code: 'MEMORY_SYNC_PORT_REQUIRED'})
        const needle = String(query || '').trim().toLowerCase()
        const filtered = needle
            ? rows.filter(item => `${item.title}\n${item.sourceKey || item.sourcePath}\n${item.metadata?.keywords || item.keywords || ''}`.toLowerCase().includes(needle))
            : rows
        return filtered.slice(0, Math.max(1, Math.min(500, Number(limit) || 200)))
    }

    async listAsync({encodedDir, query = '', limit = 200} = {}) {
        const rows = await this.memoryRepository.list({projectKey: String(encodedDir || ''), status: null, limit: 500})
        const needle = String(query || '').trim().toLowerCase()
        return rows
            .map(row => ({
                sourcePath: row.sourceKey || row.sourcePath,
                title: row.title || row.sourceKey,
                scope: row.scope || 'project',
                status: row.status || 'active',
                keywords: row.metadata?.keywords || '',
                schemaVersion: Number(row.metadata?.schemaVersion || 1),
                memoryType: row.metadata?.memoryType || 'fact',
                parentKey: row.metadata?.parentKey || null,
                l0: row.metadata?.l0 || '',
                l1: row.metadata?.l1 || '',
                confidence: Number(row.metadata?.confidence ?? 1),
                lastVerifiedAt: row.metadata?.lastVerifiedAt || null,
                updatedAt: row.updatedAt || null,
            }))
            .filter(item => !needle || `${item.title}\n${item.sourcePath}\n${item.keywords}`.toLowerCase().includes(needle))
            .slice(0, Math.max(1, Math.min(500, Number(limit) || 200)))
    }

    async loadAsync({encodedDir, sourcePath, tier = 'l2'} = {}) {
        const key = String(encodedDir || '')
        const source = String(sourcePath || '')
        if (!key || !source) return null
        const row = typeof this.memoryRepository.load === 'function'
            ? await this.memoryRepository.load({projectKey: key, sourceKey: source, tier})
            : await this.memoryRepository.get({projectKey: key, sourceKey: source})
        if (!row) return null
        if (Object.hasOwn(row, 'selectedBody')) return row
        const selected = selectMemoryContent(row, tier)
        return {...row, selectedTier: selected.tier, selectedBody: selected.content}
    }

    async scalePolicyAsync({encodedDir, keywordRecall = null, injectionBytes = 0, thresholds = {}} = {}) {
        const key = String(encodedDir || '')
        if (!key) return decideMemoryScalePolicy({count: 0, keywordRecall, injectionBytes, thresholds})
        const count = typeof this.memoryRepository.count === 'function'
            ? await this.memoryRepository.count({projectKey: key, status: 'active'})
            : (await this.memoryRepository.list({projectKey: key, status: 'active', limit: 500})).length
        return decideMemoryScalePolicy({count, keywordRecall, injectionBytes, thresholds})
    }

    disable({encodedDir, sourcePath} = {}) {
        return this.setEnabled({encodedDir, sourcePath, enabled: false})
    }

    setEnabled({encodedDir, sourcePath, enabled = true} = {}) {
        const key = String(encodedDir || '')
        const safeSource = normalizeSourcePath(sourcePath)
        if (!key || !safeSource) return false
        const rows = this.memoryRepository.list({projectKey: key, status: null, limit: 500})
        if (rows?.then) throw Object.assign(new Error('同步 Memory 状态读取需要同步 Repository port'), {code: 'MEMORY_SYNC_PORT_REQUIRED'})
        const row = rows.find(item => (item.sourceKey || item.sourcePath) === safeSource)
        if (!row) return false
        const result = enabled
            ? this.memoryRepository.put({projectKey: key, sourceKey: safeSource, title: row.title, body: row.body || '', bodyHash: row.bodyHash || row.contentHash, scope: row.scope, status: 'active', metadata: {...(row.metadata || {}), keywords: row.metadata?.keywords || row.keywords || ''}, updatedAt: this.now()})
            : this.memoryRepository.disable({projectKey: key, sourceKey: safeSource, updatedAt: this.now()})
        if (result?.then) throw Object.assign(new Error('同步 Memory 状态写入需要同步 Repository port'), {code: 'MEMORY_SYNC_PORT_REQUIRED'})
        return true
    }

    async setEnabledAsync({encodedDir, sourcePath, enabled = true} = {}) {
        const key = String(encodedDir || '')
        const safeSource = normalizeSourcePath(sourcePath)
        if (!key || !safeSource) return false
        const row = await this.memoryRepository.get({projectKey: key, sourceKey: safeSource})
        if (!row) return false
        if (enabled) {
            await this.memoryRepository.put({projectKey: key, sourceKey: safeSource, title: row.title, body: row.body || '', bodyHash: row.bodyHash, scope: row.scope, status: 'active', metadata: row.metadata || {}, updatedAt: this.now()})
        } else {
            await this.memoryRepository.disable({projectKey: key, sourceKey: safeSource, updatedAt: this.now()})
        }
        return true
    }

    remove({encodedDir, sourcePath} = {}) {
        const key = String(encodedDir || '')
        const safeSource = normalizeSourcePath(sourcePath)
        if (!key || !safeSource) return false
        const result = this.memoryRepository.remove({projectKey: key, sourceKey: safeSource})
        if (result?.then) throw Object.assign(new Error('同步 Memory 删除需要同步 Repository port'), {code: 'MEMORY_SYNC_PORT_REQUIRED'})
        return result
    }

    async removeAsync({encodedDir, sourcePath} = {}) {
        const safeSource = normalizeSourcePath(sourcePath)
        if (!safeSource) return false
        return this.memoryRepository.remove({projectKey: String(encodedDir || ''), sourceKey: safeSource})
    }

    rebuild({workDir, encodedDir = memoryProjectKey(workDir)} = {}) {
        if (!workDir || !encodedDir) throw Object.assign(new TypeError('Memory 项目参数无效'), {code: 'MEMORY_PROJECT_INVALID'})
        const key = String(encodedDir)
        const previous = this.memoryRepository.list({projectKey: key, status: null, limit: 500}) || []
        if (previous?.then) throw Object.assign(new Error('同步 Memory 重建需要同步 Repository port'), {code: 'MEMORY_SYNC_PORT_REQUIRED'})
        for (const row of previous) {
            const result = this.memoryRepository.remove({projectKey: key, sourceKey: row.sourceKey || row.sourcePath})
            if (result?.then) throw Object.assign(new Error('同步 Memory 重建需要同步 Repository port'), {code: 'MEMORY_SYNC_PORT_REQUIRED'})
        }
        const result = this.refreshProject({workDir, encodedDir})
        const rebuiltRows = this.memoryRepository.list({projectKey: key, status: null, limit: 500}) || []
        if (rebuiltRows?.then) throw Object.assign(new Error('同步 Memory 重建需要同步 Repository port'), {code: 'MEMORY_SYNC_PORT_REQUIRED'})
        const rebuilt = new Map(rebuiltRows.map(item => [item.sourceKey || item.sourcePath, item]))
        for (const old of previous) {
            const sourceKey = old.sourceKey || old.sourcePath
            const current = rebuilt.get(sourceKey)
            if (!current || (old.bodyHash || old.contentHash) !== (current.bodyHash || current.contentHash)) continue
            const restore = old.status === 'disabled'
                ? this.memoryRepository.disable({projectKey: key, sourceKey, updatedAt: this.now()})
                : true
            if (restore?.then) throw Object.assign(new Error('同步 Memory 状态恢复需要同步 Repository port'), {code: 'MEMORY_SYNC_PORT_REQUIRED'})
        }
        return result
    }

    async rebuildAsync({workDir, encodedDir = memoryProjectKey(workDir)} = {}) {
        const key = String(encodedDir || '')
        const previous = await this.memoryRepository.list({projectKey: key, status: null, limit: 500})
        const result = await this.refreshProjectAsync({workDir, encodedDir: key})
        const current = await this.memoryRepository.list({projectKey: key, status: null, limit: 500})
        const currentKeys = new Set(current.map(row => row.sourceKey))
        for (const old of previous) {
            if (!currentKeys.has(old.sourceKey) && !preserveDatabaseMemory(old)) await this.memoryRepository.remove({projectKey: key, sourceKey: old.sourceKey})
            else if (old.status === 'disabled') await this.memoryRepository.disable({projectKey: key, sourceKey: old.sourceKey, updatedAt: this.now()})
        }
        return result
    }
}

export function createMemoryService(options = {}) {
    return new BridgeMemoryService(options)
}
