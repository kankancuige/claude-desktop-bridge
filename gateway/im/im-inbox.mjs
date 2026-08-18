import {existsSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {mkdirSync} from 'node:fs'

export function claimDurableInboxMessage({inbox, deduper, messageId, payload}) {
    const id = String(messageId || '')
    if (!id) return {accepted: true, persistent: false, untracked: true}
    if (!deduper.add(id)) return {accepted: false, persistent: true, duplicate: true}

    let claim
    try {
        claim = inbox.claim(id, payload)
    } catch (error) {
        deduper.forget(id)
        throw error
    }
    if (!claim.accepted) return claim
    if (claim.persistent) return claim

    deduper.forget(id)
    throw Object.assign(new Error('IM inbox 持久化失败'), {code: 'inbox_persist_failed'})
}

/**
 * IM 事件 inbox：在平台 ACK 之后仍保留事件状态，避免 Gateway 重启后重复执行或丢失处理进度。
 * 保存事件 ID、状态和加密恢复载荷；不明文保存消息正文、token 或用户凭据。
 */
export class ImInbox {
    constructor({filePath, legacyFilePath = null, platform, payloadCodec = null, ttlMs = 24 * 60 * 60 * 1000, maxEntries = 10_000, retryAfterMs = 30_000, onPersistError = null, stateStore = null} = {}) {
        if (!filePath || !platform) throw new TypeError('filePath and platform are required')
        this.filePath = filePath
        this.legacyFilePath = legacyFilePath && legacyFilePath !== filePath ? legacyFilePath : null
        this.platform = String(platform)
        this.ttlMs = ttlMs
        this.maxEntries = maxEntries
        this.retryAfterMs = retryAfterMs
        this.payloadCodec = payloadCodec
        this.onPersistError = typeof onPersistError === 'function' ? onPersistError : null
        this.stateStore = stateStore?.available ? stateStore : null
        this._entries = new Map()
        const loadedFromLegacy = this._load()
        if (loadedFromLegacy && this._entries.size > 0) this._persist()
    }

    _load() {
        if (this.stateStore) {
            const persisted = this.stateStore.loadEntries('inbox', this.platform)
            for (const [key, value] of persisted) {
                if (value && typeof value === 'object' && Number.isFinite(value.at)) this._entries.set(key, value)
            }
            this._cleanup()
            if (this._entries.size > 0) return false
        }
        const sourcePath = !existsSync(this.filePath) && this.legacyFilePath && existsSync(this.legacyFilePath)
            ? this.legacyFilePath
            : this.filePath
        try {
            const data = JSON.parse(readFileSync(sourcePath, 'utf8'))
            const entries = data?.entries && typeof data.entries === 'object' ? data.entries : {}
            const now = Date.now()
            const prefix = `${this.platform}:`
            for (const [key, value] of Object.entries(entries)) {
                if (!key.startsWith(prefix)) continue
                if (!value || typeof value !== 'object' || !Number.isFinite(value.at)) continue
                if (now - value.at <= this.ttlMs) this._entries.set(key, value)
            }
            return sourcePath !== this.filePath || Boolean(this.stateStore && this._entries.size > 0)
        } catch (error) {
            if (error?.code !== 'ENOENT' && existsSync(sourcePath)) this._quarantineCorruptFile(error, sourcePath)
            return false
        }
    }

    _quarantineCorruptFile(error, sourcePath = this.filePath) {
        this.onPersistError?.(error)
        const corruptPath = `${sourcePath}.corrupt-${Date.now()}`
        try {
            renameSync(sourcePath, corruptPath)
            return true
        } catch (renameError) {
            if (renameError?.code === 'ENOENT') return true
            this.onPersistError?.(renameError)
            return false
        }
    }

    _key(messageId) {
        const id = String(messageId || '').trim().slice(0, 240)
        return id ? `${this.platform}:${id}` : ''
    }

    _cleanup(now = Date.now()) {
        for (const [key, value] of this._entries) {
            if (!value || now - value.at > this.ttlMs) this._entries.delete(key)
        }
    }

    _persist() {
        if (this.stateStore) {
            try {
                this.stateStore.replaceEntries('inbox', this.platform, this._entries)
                return true
            } catch (error) {
                this.onPersistError?.(error)
                return false
            }
        }
        // 每个平台只替换自己拥有的记录，保留磁盘上其他平台的最新状态。
        this._cleanup()
        const merged = new Map()
        const prefix = `${this.platform}:`
        try {
            const disk = JSON.parse(readFileSync(this.filePath, 'utf8'))
            for (const [key, value] of Object.entries(disk?.entries || {})) {
                if (!key.startsWith(prefix) && value && typeof value === 'object' && Number.isFinite(value.at)) {
                    merged.set(key, value)
                }
            }
        } catch (error) {
            if (error?.code !== 'ENOENT' && !this._quarantineCorruptFile(error)) return false
        }
        for (const [key, value] of this._entries) {
            merged.set(key, value)
        }
        try {
            mkdirSync(dirname(this.filePath), {recursive: true})
            const tmp = join(dirname(this.filePath), `.${this.filePath.split(/[\\/]/).pop()}.tmp`)
            const json = JSON.stringify({version: 1, entries: Object.fromEntries(merged)})
            writeFileSync(tmp, json, {encoding: 'utf8', mode: 0o600})
            try {
                renameSync(tmp, this.filePath)
            } catch (renameError) {
                writeFileSync(this.filePath, json, {encoding: 'utf8', mode: 0o600})
                try { unlinkSync(tmp) } catch (cleanupError) {
                    this.onPersistError?.(new AggregateError([renameError, cleanupError], 'inbox 临时文件清理失败'))
                }
            }
            return true
        } catch (error) {
            this.onPersistError?.(error)
            return false
        }
    }

    claim(messageId, payload = undefined) {
        const key = this._key(messageId)
        if (!key) return {accepted: true, persistent: false}
        const now = Date.now()
        this._cleanup(now)
        const previous = this._entries.get(key)
        if (previous?.state === 'completed') return {accepted: false, duplicate: true}
        if (previous?.state === 'processing' && now - previous.at < this.retryAfterMs) {
            return {accepted: false, duplicate: true, processing: true}
        }
        if (!previous && this._entries.size >= this.maxEntries) {
            const error = Object.assign(new Error('IM inbox 已达容量上限'), {code: 'inbox_capacity_exceeded'})
            this.onPersistError?.(error)
            return {accepted: true, persistent: false, capacityExceeded: true}
        }
        let encryptedPayload = previous?.payload
        if (payload !== undefined && this.payloadCodec) encryptedPayload = this.payloadCodec.encode(payload)
        this._entries.set(key, {
            state: 'processing',
            at: now,
            attempts: Math.min(100, Number(previous?.attempts || 0) + 1),
            ...(encryptedPayload ? {payload: encryptedPayload} : {}),
        })
        const persistent = this._persist()
        return {accepted: true, persistent}
    }

    complete(messageId) {
        const key = this._key(messageId)
        if (!key) return
        this._entries.set(key, {state: 'completed', at: Date.now(), attempts: this._entries.get(key)?.attempts || 1})
        return this._persist()
    }

    recoverable({olderThanMs = 0, maxAttempts = 5, limit = 100} = {}) {
        if (!this.payloadCodec) return []
        const prefix = `${this.platform}:`
        const now = Date.now()
        const out = []
        for (const [key, value] of this._entries) {
            if (!key.startsWith(prefix) || !value?.payload || value.state === 'completed') continue
            if (now - value.at < olderThanMs || Number(value.attempts || 0) >= maxAttempts) continue
            try {
                out.push({
                    messageId: key.slice(prefix.length),
                    payload: this.payloadCodec.decode(value.payload),
                    attempts: Number(value.attempts || 0),
                    state: value.state,
                })
            } catch (error) {
                this.fail(key.slice(prefix.length), error || 'payload_decrypt_failed')
            }
            if (out.length >= limit) break
        }
        return out
    }

    fail(messageId, error) {
        const key = this._key(messageId)
        if (!key) return
        const previous = this._entries.get(key)
        this._entries.set(key, {
            state: 'failed',
            at: Date.now(),
            attempts: previous?.attempts || 1,
            ...(previous?.payload ? {payload: previous.payload} : {}),
            error: String(error?.code || error?.message || error || 'failed').slice(0, 160),
        })
        return this._persist()
    }
}
