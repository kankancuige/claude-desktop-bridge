import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {listMemoryFiles, memoryFileMetadata, memoryProjectKey, memorySearchTokens} from '../storage/memory-index.mjs'

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

export class BridgeMemoryService {
    constructor({bridgeHome, stateStore = null, maxBytes = DEFAULT_INJECTION_BYTES, maxChars = null, now = () => Date.now(), logger = null} = {}) {
        if (!bridgeHome) throw new TypeError('bridgeHome is required')
        this.bridgeHome = bridgeHome
        this.stateStore = stateStore?.available ? stateStore : null
        const configuredBudget = maxChars ?? maxBytes
        this.maxBytes = Math.max(512, Math.min(32 * 1024, Number(configuredBudget) || DEFAULT_INJECTION_BYTES))
        this.now = now
        this.logger = logger
    }

    refreshProject({workDir, encodedDir = memoryProjectKey(workDir)} = {}) {
        if (!workDir || !encodedDir || !this.stateStore) return {indexed: 0, removed: 0, mode: 'file'}
        const key = String(encodedDir)
        const files = listMemoryFiles({bridgeHome: this.bridgeHome, encodedDir: key})
        const current = new Set()
        const known = new Map([
            ...(this.stateStore.listMemoryIndex(key, {status: 'active', limit: 500}) || []),
            ...(this.stateStore.listMemoryIndex(key, {status: 'disabled', limit: 500}) || []),
        ].map(item => [item.sourcePath, item]))
        let indexed = 0
        for (const file of files) {
            try {
                const metadata = memoryFileMetadata({projectKey: key, sourcePath: file.sourcePath, filePath: file.filePath, now: this.now()})
                const previous = known.get(file.sourcePath)
                if (previous?.status === 'disabled' && previous.contentHash === metadata.contentHash) metadata.status = 'disabled'
                this.stateStore.upsertMemoryIndex(metadata)
                current.add(file.sourcePath)
                indexed++
            } catch (error) {
                this.logger?.warn?.({err: error, projectKey: key, sourcePath: file.sourcePath}, 'Memory 文件索引失败')
            }
        }
        const old = this.stateStore.listMemoryIndex(key, {status: null, limit: 500})
        let removed = 0
        for (const item of old) {
            if (!current.has(item.sourcePath)) {
                this.stateStore.removeMemoryIndex(key, item.sourcePath)
                removed++
            }
        }
        return {indexed, removed, mode: 'sqlite'}
    }

    retrieve({workDir, encodedDir = memoryProjectKey(workDir), text, maxBytes = this.maxBytes, maxChars = null} = {}) {
        const prompt = String(text || '').trim()
        if (!workDir || !prompt || (!ACTION_TASK.test(prompt) && !EXPLICIT_MEMORY.test(prompt)) || /(?:不要|禁止|别|不需要).{0,8}(?:记住|记忆|memory|记录)/i.test(prompt)) {
            return {text: '', items: [], reason: 'not_relevant'}
        }
        const key = String(encodedDir)
        let rows = []
        if (this.stateStore) {
            this.refreshProject({workDir, encodedDir: key})
            rows = this.stateStore.listMemoryIndex(key, {status: 'active', limit: 200}) || []
        } else {
            rows = listMemoryFiles({bridgeHome: this.bridgeHome, encodedDir: key}).flatMap(file => {
                try { return [memoryFileMetadata({projectKey: key, sourcePath: file.sourcePath, filePath: file.filePath, now: this.now()})] } catch { return [] }
            })
        }
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
        const configuredBudget = maxChars ?? maxBytes
        const budget = Math.max(512, Math.min(32 * 1024, Number(configuredBudget) || this.maxBytes))
        let remaining = budget - Buffer.byteLength(MEMORY_PREFIX + MEMORY_SUFFIX, 'utf8')
        for (const {row, score} of scored) {
            const sourcePath = String(row.sourcePath || '')
            if (!normalizeSourcePath(sourcePath)) continue
            const path = join(this.bridgeHome, 'projects', key, ...sourcePath.split('/'))
            if (!existsSync(path)) continue
            try {
                const content = readFileSync(path, 'utf8')
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
                this.stateStore?.markMemoryUsed?.(key, sourcePath, this.now())
                remaining -= fixedBytes + Buffer.byteLength(snippet, 'utf8')
            } catch (error) {
                this.logger?.debug?.({err: error, sourcePath: row.sourcePath}, '读取 Memory 内容失败')
            }
        }
        if (!parts.length) return {text: '', items, reason: 'no_match'}
        return {
            text: `${MEMORY_PREFIX}${parts.join('\n\n')}${MEMORY_SUFFIX}`,
            items,
            reason: 'matched',
        }
    }

    list({encodedDir, status = null, query = '', limit = 200} = {}) {
        const rows = this.stateStore?.listMemoryIndex(String(encodedDir || ''), {status, limit: 500}) || []
        const needle = String(query || '').trim().toLowerCase()
        const filtered = needle
            ? rows.filter(item => `${item.title}\n${item.sourcePath}\n${item.keywords}`.toLowerCase().includes(needle))
            : rows
        return filtered.slice(0, Math.max(1, Math.min(500, Number(limit) || 200)))
    }

    disable({encodedDir, sourcePath} = {}) {
        return this.setEnabled({encodedDir, sourcePath, enabled: false})
    }

    setEnabled({encodedDir, sourcePath, enabled = true} = {}) {
        const key = String(encodedDir || '')
        const safeSource = normalizeSourcePath(sourcePath)
        if (!this.stateStore || !key || !safeSource) return false
        const rows = this.stateStore.listMemoryIndex(key, {status: null, limit: 500})
        const row = rows.find(item => item.sourcePath === safeSource)
        if (!row) return false
        this.stateStore.upsertMemoryIndex({...row, status: enabled ? 'active' : 'disabled'})
        return true
    }

    remove({encodedDir, sourcePath} = {}) {
        const key = String(encodedDir || '')
        const safeSource = normalizeSourcePath(sourcePath)
        if (!this.stateStore || !key || !safeSource) return false
        return this.stateStore.removeMemoryIndex(key, safeSource)
    }

    rebuild({workDir, encodedDir = memoryProjectKey(workDir)} = {}) {
        if (!workDir || !encodedDir) throw Object.assign(new TypeError('Memory 项目参数无效'), {code: 'MEMORY_PROJECT_INVALID'})
        const key = String(encodedDir)
        const previous = this.stateStore?.listMemoryIndex?.(key, {status: null, limit: 500}) || []
        this.stateStore?.clearMemoryIndex?.(key)
        const result = this.refreshProject({workDir, encodedDir})
        if (this.stateStore) {
            const rebuilt = new Map(this.stateStore.listMemoryIndex(key, {status: null, limit: 500})
                .map(item => [item.sourcePath, item]))
            for (const old of previous) {
                const current = rebuilt.get(old.sourcePath)
                if (!current || old.contentHash !== current.contentHash) continue
                this.stateStore.upsertMemoryIndex({
                    ...current,
                    status: old.status,
                    lastUsedAt: old.lastUsedAt,
                })
            }
        }
        return result
    }
}

export function createMemoryService(options = {}) {
    return new BridgeMemoryService(options)
}
