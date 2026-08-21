import crypto from 'node:crypto'

const DEDUPE_RETENTION_MS = 10 * 60 * 1000

function pendingInputs(session) {
    if (!Array.isArray(session._pendingInputs)) session._pendingInputs = []
    return session._pendingInputs
}

function inputIds(session) {
    if (!(session._inputIds instanceof Map)) session._inputIds = new Map()
    return session._inputIds
}

function normalizeId(value, createId) {
    return String(value || createId()).slice(0, 200)
}

export function consumeTaskInput(session, {onlyWhenIdle = false} = {}) {
    if (!session || (onlyWhenIdle && session.activeTurnId)) return null
    return pendingInputs(session).shift() || null
}

/**
 * 会话输入队列只维护本地顺序和去重状态；事件投递与 SDK 推送仍由调用方负责，避免循环依赖。
 */
export function createTaskInputQueue({maxPending = 32, imSources = new Set(), createId = () => crypto.randomUUID(), now = () => Date.now()} = {}) {
    const max = Math.max(1, Math.trunc(Number(maxPending) || 32))

    function removeExpiredIds(session, timestamp) {
        for (const [id, acceptedAt] of inputIds(session)) {
            if (timestamp - Number(acceptedAt || 0) > DEDUPE_RETENTION_MS) session._inputIds.delete(id)
        }
    }

    return {
        accept(session, {source = 'desktop', messageId, userId = null, taskDecision = null} = {}) {
            const timestamp = now()
            const ids = inputIds(session)
            removeExpiredIds(session, timestamp)
            const id = normalizeId(messageId, createId)
            const normalizedSource = String(source || 'desktop')
            const dedupeKey = `${normalizedSource}\0${String(userId || '')}\0${id}`
            if (ids.has(dedupeKey)) return {ok: false, duplicate: true, messageId: id}

            const pending = pendingInputs(session)
            const queued = pending.length + (session.activeTurnId ? 1 : 0)
            if (queued >= max) return {ok: false, error: 'input_queue_full', queuePosition: queued}

            const turnId = crypto.randomUUID()
            ids.set(dedupeKey, timestamp)
            pending.push({
                messageId: id,
                turnId,
                source: normalizedSource,
                userId: imSources.has(normalizedSource) ? String(userId || '') : null,
                taskDecision,
                dedupeKey,
            })
            return {ok: true, messageId: id, turnId, queuePosition: queued, dedupeKey}
        },

        rollback(session, accepted) {
            if (!session || !accepted?.turnId) return false
            const pending = pendingInputs(session)
            const index = pending.findIndex(item => item.turnId === accepted.turnId)
            if (index < 0) return false
            pending.splice(index, 1)
            if (accepted.dedupeKey) inputIds(session).delete(accepted.dedupeKey)
            return true
        },

        drain(session) {
            if (!session) return []
            const pending = pendingInputs(session).splice(0)
            const ids = inputIds(session)
            for (const input of pending) {
                if (input.dedupeKey) ids.delete(input.dedupeKey)
            }
            return pending
        },

        consume(session, options = {}) {
            return consumeTaskInput(session, options)
        },

        prependInternal(session, {source = 'desktop', userId = null, taskDecision = null, turnId = null} = {}) {
            pendingInputs(session).unshift({
                messageId: null,
                turnId,
                source: String(source || 'desktop'),
                userId: imSources.has(source) ? String(userId || '') : null,
                taskDecision,
            })
        },
    }
}
