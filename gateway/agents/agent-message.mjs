const MAX_SUMMARY = 1200
const MAX_REFERENCES = 20

function text(value, max = MAX_SUMMARY) {
    return typeof value === 'string' ? value.replace(/[\0\r\n]+/g, ' ').trim().slice(0, max) : ''
}

function safeReferences(value) {
    return (Array.isArray(value) ? value : []).slice(0, MAX_REFERENCES).map(item => ({
        type: text(item?.type, 80), key: text(item?.key || item?.sourceKey || item?.id, 240),
    })).filter(item => item.type && item.key)
}

function normalizeMessage(input = {}, {now, maxHops, maxAgeMs} = {}) {
    const createdAt = Number(input.createdAt) > 0 ? Number(input.createdAt) : now()
    const expiresAt = Number(input.expiresAt) > createdAt ? Number(input.expiresAt) : createdAt + maxAgeMs
    const hop = Math.max(0, Math.trunc(Number(input.hop) || 0))
    return {
        messageId: text(input.messageId, 240),
        taskId: text(input.taskId, 240),
        fromAgent: text(input.fromAgent, 120),
        toAgent: text(input.toAgent, 120),
        type: text(input.type, 80) || 'result',
        summary: text(input.summary),
        references: safeReferences(input.references),
        hop,
        maxHops,
        createdAt,
        expiresAt,
        status: 'pending',
    }
}

export function createAgentMailbox({repository = null, now = () => Date.now(), maxHops = 4, maxAgeMs = 15 * 60 * 1000, maxMessages = 100, onWake = null} = {}) {
    const limit = Math.max(1, Math.min(1000, Math.trunc(Number(maxMessages) || 100)))
    const hopLimit = Math.max(0, Math.min(20, Math.trunc(Number(maxHops) || 0)))
    const ttl = Math.max(1000, Math.min(24 * 60 * 60 * 1000, Math.trunc(Number(maxAgeMs) || 1000)))
    const memory = new Map()
    const store = repository && typeof repository === 'object' ? repository : null

    function read(messageId) {
        const key = text(messageId, 240)
        if (!key) return null
        const value = store?.get ? store.get(key) : memory.get(key)
        return value ? {...value} : null
    }

    function write(message) {
        if (store?.put) store.put(message)
        else memory.set(message.messageId, message)
        return {...message}
    }

    function send(input = {}) {
        const suppliedId = text(input.messageId, 240)
        const messageId = suppliedId || `${text(input.taskId, 80) || 'task'}:${text(input.fromAgent, 60) || 'agent'}:${now()}`
        const duplicate = read(messageId)
        if (duplicate) return {accepted: false, duplicate: true, message: duplicate}
        const message = normalizeMessage({...input, messageId}, {now, maxHops: hopLimit, maxAgeMs: ttl})
        if (!message.taskId || !message.fromAgent || !message.toAgent || !message.summary) return {accepted: false, reason: 'invalid_message', message: null}
        if (message.hop > hopLimit) return {accepted: false, reason: 'max_message_hops', message: null}
        const active = list({status: 'pending'})
        if (active.length >= limit) return {accepted: false, reason: 'mailbox_full', message: null}
        const stored = write(message)
        try { onWake?.({messageId: stored.messageId, taskId: stored.taskId, toAgent: stored.toAgent, type: stored.type}) } catch { /* 唤醒通知失败不改变消息的幂等状态 */ }
        return {accepted: true, duplicate: false, message: stored}
    }

    function list({toAgent = '', taskId = '', status = 'pending'} = {}) {
        const rows = store?.list ? store.list({toAgent, taskId, status, limit}) : [...memory.values()]
        return (Array.isArray(rows) ? rows : []).filter(item => {
            if (status && item.status !== status) return false
            if (toAgent && item.toAgent !== toAgent) return false
            if (taskId && item.taskId !== taskId) return false
            return Number(item.expiresAt || 0) > now()
        }).slice(0, limit).map(item => ({...item}))
    }

    function ack(messageId, {status = 'consumed'} = {}) {
        const current = read(messageId)
        if (!current) return false
        if (!['pending', 'in_flight', 'consumed', 'failed', 'expired'].includes(status)) return false
        const next = {...current, status, updatedAt: now()}
        write(next)
        return true
    }

    function consume({toAgent = '', taskId = '', limit = 20} = {}) {
        const rows = list({toAgent, taskId, status: 'pending'}).slice(0, Math.max(1, Math.min(50, Number(limit) || 20)))
        return rows.map(row => {
            ack(row.messageId, {status: 'in_flight'})
            return {...row, status: 'in_flight'}
        })
    }

    function expire() {
        const rows = store?.list ? store.list({limit}) : [...memory.values()]
        const expired = (Array.isArray(rows) ? rows : []).filter(item => ['pending', 'in_flight'].includes(item.status) && Number(item.expiresAt || 0) <= now())
        for (const item of expired) ack(item.messageId, {status: 'expired'})
        return expired.length
    }

    return {send, list, get: read, ack, consume, expire, limits: {maxHops: hopLimit, maxAgeMs: ttl, maxMessages: limit}}
}
