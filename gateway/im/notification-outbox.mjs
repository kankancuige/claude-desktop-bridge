import crypto from 'node:crypto'

export function summarizeNotificationEntries(entries, platform) {
    const prefix = `${platform}:`
    const result = {pending: 0, failed: 0, dead: 0, sent: 0}
    for (const [key, value] of Object.entries(entries || {})) {
        if (key.startsWith(prefix) && Object.hasOwn(result, value?.state)) result[value.state]++
    }
    return result
}

function notificationEnqueueResult(key, platform, duplicate, state, structured) {
    const id = key.slice(platform.length + 1)
    return structured ? {id, duplicate, state} : id
}

export class NotificationOutbox {
    constructor({platform, payloadCodec, maxEntries = 2_000, maxAttempts = 8, sentTtlMs = 24 * 60 * 60 * 1000, onPersistError = null, repository = null} = {}) {
        if (!platform || !payloadCodec || !repository?.loadEntries || !repository?.replaceEntries) throw new TypeError('platform, payloadCodec and repository are required')
        this.platform = String(platform)
        this.payloadCodec = payloadCodec
        this.maxEntries = maxEntries
        this.maxAttempts = maxAttempts
        this.sentTtlMs = sentTtlMs
        this.onPersistError = typeof onPersistError === 'function' ? onPersistError : null
        this.repository = repository
        this._entries = new Map()
        this._load()
    }

    _load() {
        const persisted = this.repository.loadEntries({kind: 'outbox', platform: this.platform})
        for (const [key, value] of persisted) {
            if (value && typeof value === 'object' && Number.isFinite(value.updatedAt)) this._entries.set(key, value)
        }
        this._cleanup()
    }

    _cleanup(now = Date.now()) {
        for (const [key, value] of this._entries) {
            if (value?.state === 'sent' && now - value.updatedAt > this.sentTtlMs) this._entries.delete(key)
        }
    }

    _reserveCapacity(key) {
        this._cleanup()
        if (this._entries.has(key)) return true
        while (this._entries.size >= this.maxEntries) {
            const sent = [...this._entries].find(([, value]) => value?.state === 'sent')
            if (!sent) break
            this._entries.delete(sent[0])
        }
        if (this._entries.size < this.maxEntries) return true
        this.onPersistError?.(Object.assign(new Error('通知 outbox 已达容量上限'), {code: 'outbox_capacity_exceeded'}))
        return false
    }

    _persist() {
        this._cleanup()
        try {
            this.repository.replaceEntries({kind: 'outbox', platform: this.platform, entries: this._entries})
            return true
        } catch (error) {
            this.onPersistError?.(error)
            return false
        }
    }

    enqueue(payload, options = {}) {
        const structured = Object.hasOwn(options, 'id') && options.id !== undefined && options.id !== null
        const id = structured ? options.id : crypto.randomUUID()
        const deferMs = options.deferMs || 0
        const key = `${this.platform}:${String(id).slice(0, 240)}`
        const previousEntries = new Map(this._entries)
        const existing = this._entries.get(key)
        if (existing) return notificationEnqueueResult(key, this.platform, true, existing.state, structured)
        if (!this._reserveCapacity(key)) return null
        const now = Date.now()
        this._entries.set(key, {
            platform: this.platform,
            state: 'pending',
            attempts: 0,
            nextAttemptAt: now + Math.max(0, Number(deferMs) || 0),
            createdAt: now,
            updatedAt: now,
            payload: this.payloadCodec.encode(payload),
        })
        if (!this._persist()) {
            this._entries = previousEntries
            return null
        }
        return notificationEnqueueResult(key, this.platform, false, 'pending', structured)
    }

    due({limit = 20, maxAttempts = 8, now = Date.now()} = {}) {
        const prefix = `${this.platform}:`
        const out = []
        for (const [key, value] of this._entries) {
            if (!key.startsWith(prefix) || value?.state === 'sent' || value?.state === 'dead') continue
            const allowedAttempts = Math.min(maxAttempts, this.maxAttempts)
            if (Number(value.attempts || 0) >= allowedAttempts) {
                this.fail(key.slice(prefix.length), value.lastError || 'max_attempts_reached', {permanent: true, increment: false})
                continue
            }
            if (Number(value.nextAttemptAt || 0) > now) continue
            try {
                out.push({
                    id: key.slice(prefix.length),
                    payload: this.payloadCodec.decode(value.payload),
                    attempts: Number(value.attempts || 0),
                })
            } catch (error) {
                this.fail(key.slice(prefix.length), error || 'payload_decrypt_failed', {permanent: true})
            }
            if (out.length >= limit) break
        }
        return out
    }

    complete(id) {
        const key = `${this.platform}:${String(id || '')}`
        const previous = this._entries.get(key)
        if (!previous) return
        this._entries.set(key, {
            platform: this.platform,
            state: 'sent',
            attempts: previous.attempts || 0,
            createdAt: previous.createdAt,
            updatedAt: Date.now(),
        })
        if (!this._persist()) {
            this._entries.set(key, previous)
            return false
        }
        return true
    }

    fail(id, error, {permanent = false, increment = true} = {}) {
        const key = `${this.platform}:${String(id || '')}`
        const previous = this._entries.get(key)
        if (!previous) return
        const attempts = Math.min(100, Number(previous.attempts || 0) + (increment ? 1 : 0))
        const isDead = permanent || attempts >= this.maxAttempts
        const delay = isDead ? 365 * 24 * 60 * 60 * 1000 : Math.min(15 * 60 * 1000, 5_000 * (2 ** Math.min(attempts - 1, 8)))
        this._entries.set(key, {
            ...previous,
            state: isDead ? 'dead' : 'failed',
            attempts,
            nextAttemptAt: Date.now() + delay,
            updatedAt: Date.now(),
            lastError: String(error?.code || error?.message || error || 'send_failed').slice(0, 200),
        })
        if (!this._persist()) {
            this._entries.set(key, previous)
            return false
        }
        return true
    }

    retryFailed({includeDead = true} = {}) {
        let reset = 0
        const previousEntries = new Map(this._entries)
        const now = Date.now()
        for (const [key, value] of this._entries) {
            if (value?.state !== 'failed' && !(includeDead && value?.state === 'dead')) continue
            this._entries.set(key, {
                ...value,
                state: 'pending',
                attempts: 0,
                nextAttemptAt: now,
                updatedAt: now,
                lastError: undefined,
            })
            reset++
        }
        if (reset > 0 && !this._persist()) {
            this._entries = previousEntries
            return 0
        }
        return reset
    }

    discard({states = ['dead']} = {}) {
        const selected = new Set(states)
        const previousEntries = new Map(this._entries)
        let deleted = 0
        for (const [key, value] of this._entries) {
            if (!selected.has(value?.state)) continue
            this._entries.delete(key)
            deleted++
        }
        if (deleted > 0 && !this._persist()) {
            this._entries = previousEntries
            return 0
        }
        return deleted
    }

    summary() {
        return summarizeNotificationEntries(Object.fromEntries(this._entries), this.platform)
    }

    status(notificationId) {
        const prefix = `${this.platform}:${String(notificationId || '')}:part:`
        const entries = [...this._entries].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value)
        if (!entries.length) return null
        if (entries.some(value => value?.state === 'dead')) return {state: 'dead', lastError: entries.find(value => value?.state === 'dead')?.lastError || ''}
        if (entries.some(value => value?.state === 'failed')) return {state: 'failed', lastError: entries.find(value => value?.state === 'failed')?.lastError || ''}
        if (entries.some(value => value?.state === 'pending')) return {state: 'pending', lastError: ''}
        return {state: 'sent', lastError: ''}
    }
}
