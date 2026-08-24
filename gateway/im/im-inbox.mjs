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
    constructor({platform, payloadCodec = null, ttlMs = 24 * 60 * 60 * 1000, maxEntries = 10_000, retryAfterMs = 30_000, onPersistError = null, repository = null} = {}) {
        if (!platform || !repository?.loadEntries || !repository?.replaceEntries) throw new TypeError('platform and repository are required')
        this.platform = String(platform)
        this.ttlMs = ttlMs
        this.maxEntries = maxEntries
        this.retryAfterMs = retryAfterMs
        this.payloadCodec = payloadCodec
        this.onPersistError = typeof onPersistError === 'function' ? onPersistError : null
        this.repository = repository
        this._entries = new Map()
        this._load()
    }

    _load() {
        const persisted = this.repository.loadEntries({kind: 'inbox', platform: this.platform})
        for (const [key, value] of persisted) {
            if (value && typeof value === 'object' && Number.isFinite(value.at)) this._entries.set(key, value)
        }
        this._cleanup()
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
        try {
            this.repository.replaceEntries({kind: 'inbox', platform: this.platform, entries: this._entries})
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
