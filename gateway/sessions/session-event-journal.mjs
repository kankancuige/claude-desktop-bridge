import {
    closeSync,
    existsSync,
    fsyncSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    statSync,
    writeFileSync,
    writeSync,
} from 'node:fs'
import {dirname, join} from 'node:path'
import {normalizeTaskState} from '../tasks/task-state.mjs'

const FORBIDDEN_KEYS = new Set([
    'prompt', 'content', 'message', 'messages', 'assistant', 'assistanttext', 'replytext',
    'apikey', 'authtoken', 'accesstoken', 'password', 'secret', 'requestbody', 'responsebody',
    'toolresult', 'tooloutput', 'output',
])
const MAX_EVENT_BYTES = 64 * 1024

function journalError(message, code) {
    return Object.assign(new Error(message), {code})
}

function validatePayload(value, path = 'payload', seen = new Set()) {
    if (value === null || value === undefined) return
    if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
        throw journalError(`${path} 包含不可序列化值`, 'SESSION_EVENT_INVALID_PAYLOAD')
    }
    if (typeof value !== 'object') return
    if (seen.has(value)) throw journalError(`${path} 包含循环引用`, 'SESSION_EVENT_INVALID_PAYLOAD')
    seen.add(value)
    for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
            throw journalError(`${path}.${key} 不允许写入事件日志`, 'SESSION_EVENT_SENSITIVE_FIELD')
        }
        validatePayload(child, `${path}.${key}`, seen)
    }
    seen.delete(value)
}

function parseJournalText(text) {
    if (!text) return {ok: true, events: [], lastSeq: 0, tailIgnored: false, validText: ''}
    const endsWithNewline = text.endsWith('\n')
    const parts = text.split('\n')
    if (parts.at(-1) === '') parts.pop()
    const tailIgnored = !endsWithNewline && parts.length > 0
    if (tailIgnored) parts.pop()
    const events = []
    let previousSeq = null
    for (let index = 0; index < parts.length; index++) {
        const line = parts[index]
        if (!line.trim()) continue
        let event
        try {
            event = JSON.parse(line)
        } catch (error) {
            return {ok: false, code: 'SESSION_EVENT_JOURNAL_CORRUPT', line: index + 1, error, events: []}
        }
        if (!Number.isInteger(event?.seq) || event.seq < 1 || typeof event.type !== 'string') {
            return {ok: false, code: 'SESSION_EVENT_JOURNAL_CORRUPT', line: index + 1, events: []}
        }
        if (previousSeq !== null && event.seq !== previousSeq + 1) {
            return {ok: false, code: 'SESSION_EVENT_SEQUENCE_GAP', line: index + 1, events: []}
        }
        previousSeq = event.seq
        events.push(event)
    }
    const validText = parts.length ? `${parts.join('\n')}\n` : ''
    return {ok: true, events, lastSeq: previousSeq || 0, tailIgnored, validText}
}

export function sessionEventStorePath(projectDir, sessionId) {
    if (typeof projectDir !== 'string' || !projectDir) throw new TypeError('projectDir 无效')
    if (typeof sessionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionId)) {
        throw new TypeError('sessionId 无效')
    }
    return join(projectDir, 'bridge-session-events', `${sessionId}.jsonl`)
}

export function journalTaskState(state) {
    const normalized = normalizeTaskState(state)
    return {
        version: normalized.version,
        status: normalized.status,
        outcome: normalized.outcome,
        continuationReason: normalized.continuationReason,
        resumable: normalized.resumable,
        subtype: normalized.subtype,
        sdkSessionId: normalized.sdkSessionId,
        historySessionId: normalized.historySessionId,
        taskId: normalized.taskId,
        turnId: normalized.turnId,
        sequence: normalized.sequence,
        numTurns: normalized.numTurns,
        startedAt: normalized.startedAt,
        completedAt: normalized.completedAt,
        durationMs: normalized.durationMs,
        finalReplyText: normalized.finalReplyText,
        finalReplyAvailable: normalized.finalReplyAvailable,
        notifications: normalized.notifications,
        updatedAt: normalized.updatedAt,
        review: {
            round: normalized.review.round,
            tier: normalized.review.tier,
            blockingCount: normalized.review.blockingCount,
        },
    }
}

export class SessionEventJournal {
    constructor({path, maxBytes = 2 * 1024 * 1024, maxEvents = 2000, now = () => Date.now(), onCorrupt = () => {}} = {}) {
        if (typeof path !== 'string' || !path) throw new TypeError('journal path 无效')
        this.path = path
        this.maxBytes = Math.max(4096, Number(maxBytes) || 2 * 1024 * 1024)
        this.maxEvents = Math.max(10, Number(maxEvents) || 2000)
        this.now = now
        this.closed = false
        mkdirSync(dirname(path), {recursive: true})

        const initial = this.read()
        if (!initial.ok) {
            onCorrupt(initial)
            if (existsSync(path)) renameSync(path, `${path}.corrupt-${this.now()}`)
            this.seq = 0
        } else {
            this.seq = initial.lastSeq
            if (initial.tailIgnored) writeFileSync(path, initial.validText, 'utf8')
        }
    }

    read() {
        if (!existsSync(this.path)) return {ok: true, events: [], lastSeq: 0, tailIgnored: false, validText: ''}
        try {
            return parseJournalText(readFileSync(this.path, 'utf8'))
        } catch (error) {
            return {ok: false, code: 'SESSION_EVENT_JOURNAL_READ_FAILED', error, events: []}
        }
    }

    append(type, payload = {}, {critical = false} = {}) {
        if (this.closed) throw journalError('Session Event Journal 已关闭', 'SESSION_EVENT_JOURNAL_CLOSED')
        if (typeof type !== 'string' || !/^[a-z][a-z0-9_-]*\/[a-z][a-z0-9_-]*$/.test(type)) {
            throw journalError('事件类型无效', 'SESSION_EVENT_INVALID_TYPE')
        }
        validatePayload(payload)
        let normalizedPayload
        try {
            normalizedPayload = JSON.parse(JSON.stringify(payload ?? {}))
        } catch (error) {
            throw journalError(`事件 payload 无法序列化: ${error?.message || 'unknown'}`, 'SESSION_EVENT_INVALID_PAYLOAD')
        }
        const event = {seq: this.seq + 1, time: this.now(), type, payload: normalizedPayload}
        const line = `${JSON.stringify(event)}\n`
        if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_BYTES) {
            throw journalError('事件 payload 过大', 'SESSION_EVENT_PAYLOAD_TOO_LARGE')
        }

        const fd = openSync(this.path, 'a')
        try {
            writeSync(fd, line, null, 'utf8')
            if (critical) fsyncSync(fd)
        } finally {
            closeSync(fd)
        }
        this.seq = event.seq
        this.compactIfNeeded()
        return event
    }

    projectTaskState(options = {}) {
        const result = this.read()
        if (!result.ok) throw journalError('Session Event Journal 无法投影', result.code)
        for (let index = result.events.length - 1; index >= 0; index--) {
            const event = result.events[index]
            if (event.type === 'task/state-changed' && event.payload?.taskState) {
                return normalizeTaskState(event.payload.taskState, options)
            }
        }
        return null
    }

    compactIfNeeded() {
        if (!existsSync(this.path) || statSync(this.path).size <= this.maxBytes) return false
        const result = this.read()
        if (!result.ok) return false
        const retained = result.events.slice(-this.maxEvents)
        const text = retained.map(event => JSON.stringify(event)).join('\n') + (retained.length ? '\n' : '')
        const temporary = `${this.path}.tmp-${process.pid}-${this.now()}`
        writeFileSync(temporary, text, 'utf8')
        renameSync(temporary, this.path)
        return true
    }

    close() {
        this.closed = true
    }
}
