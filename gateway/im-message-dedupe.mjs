export class ImMessageDeduper {
    constructor({ttlMs = 24 * 60 * 60 * 1000, maxEntries = 10_000} = {}) {
        this.ttlMs = ttlMs
        this.maxEntries = maxEntries
        this._seen = new Map()
    }

    has(messageId) {
        const id = String(messageId || '')
        if (!id) return false
        const now = Date.now()
        const at = this._seen.get(id)
        if (at && now - at <= this.ttlMs) return true
        if (at) this._seen.delete(id)
        return false
    }

    add(messageId) {
        const id = String(messageId || '')
        if (!id) return false
        if (this.has(id)) return false
        this._seen.set(id, Date.now())
        while (this._seen.size > this.maxEntries) this._seen.delete(this._seen.keys().next().value)
        return true
    }

    forget(messageId) {
        const id = String(messageId || '')
        if (id) this._seen.delete(id)
    }
}
