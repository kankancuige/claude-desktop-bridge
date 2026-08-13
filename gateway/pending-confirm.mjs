/**
 * 按 IM 用户保存待确认请求。一个用户可能同时收到 parallel agent 产生的多个请求，
 * 因此不能用单个 Map 值覆盖；回复时按 FIFO 处理，网络失败时保留原请求供重试。
 */
export class PendingConfirmRegistry {
    constructor({ttlMs = 5 * 60 * 1000, maxPerUser = 8, maxUsers = 5_000} = {}) {
        if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs must be positive')
        if (!Number.isInteger(maxPerUser) || maxPerUser < 1) throw new TypeError('maxPerUser must be positive')
        if (!Number.isInteger(maxUsers) || maxUsers < 1) throw new TypeError('maxUsers must be positive')
        this.ttlMs = ttlMs
        this.maxPerUser = maxPerUser
        this.maxUsers = maxUsers
        this._users = new Map()
    }

    add(userId, request) {
        const uid = String(userId || '')
        if (!uid || !request?.sessionId || !request?.requestId) return false
        const now = Date.now()
        this.cleanup(now)
        const queue = this._users.get(uid) || []
        const duplicate = queue.some(item => item.sessionId === request.sessionId && item.requestId === request.requestId)
        if (duplicate) return false
        if (queue.length >= this.maxPerUser) return false
        if (!this._users.has(uid) && this._users.size >= this.maxUsers) return false
        queue.push({...request, _at: now})
        this._users.delete(uid)
        this._users.set(uid, queue)
        return true
    }

    peek(userId, now = Date.now()) {
        this._cleanupUser(String(userId || ''), now)
        return this._users.get(String(userId || ''))?.[0] || null
    }

    remove(userId, request) {
        const uid = String(userId || '')
        const queue = this._users.get(uid)
        if (!queue?.length) return false
        const index = queue.findIndex(item => item.sessionId === request?.sessionId && item.requestId === request?.requestId)
        if (index < 0) return false
        queue.splice(index, 1)
        if (queue.length === 0) this._users.delete(uid)
        return true
    }

    removeByRequest(sessionId, requestId) {
        for (const [uid, queue] of this._users) {
            const index = queue.findIndex(item => item.sessionId === sessionId && item.requestId === requestId)
            if (index < 0) continue
            queue.splice(index, 1)
            if (queue.length === 0) this._users.delete(uid)
            return uid
        }
        return null
    }

    cleanup(now = Date.now()) {
        for (const uid of [...this._users.keys()]) this._cleanupUser(uid, now)
    }

    clear() {
        this._users.clear()
    }

    _cleanupUser(uid, now) {
        const queue = this._users.get(uid)
        if (!queue) return
        const active = queue.filter(item => now - Number(item._at || 0) < this.ttlMs)
        if (active.length) this._users.set(uid, active)
        else this._users.delete(uid)
    }
}
