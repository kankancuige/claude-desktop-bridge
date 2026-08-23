const ALLOWED_FIELDS = new Set(['durationMs', 'retryCount', 'rebuildReason', 'usageSource', 'cleanupOutcome', 'errorCode', 'phase'])
const MAX_EVENTS = 200

function boundedString(value, max = 120) {
    if (value === null || value === undefined) return null
    return String(value).replace(/[\0\r\n]/g, ' ').slice(0, max)
}

function boundedCount(value) {
    const number = Number(value)
    return Number.isSafeInteger(number) && number >= 0 ? number : null
}

/** 只保存本地运行指标，不保存 Prompt、transcript、凭据或绝对路径。 */
export function createRuntimeDiagnostics({maxEvents = MAX_EVENTS, now = () => Date.now()} = {}) {
    const events = []
    const limit = Math.max(1, Math.min(MAX_EVENTS, Number(maxEvents) || MAX_EVENTS))

    function record(input = {}) {
        const event = {createdAt: boundedCount(now()) ?? Date.now()}
        for (const field of ALLOWED_FIELDS) {
            if (!Object.hasOwn(input, field)) continue
            if (field === 'durationMs' || field === 'retryCount') event[field] = boundedCount(input[field])
            else event[field] = boundedString(input[field])
        }
        events.push(event)
        while (events.length > limit) events.shift()
        return {...event}
    }

    function snapshot() {
        return events.map(event => ({...event}))
    }

    function summary() {
        const byPhase = {}
        const byError = {}
        for (const event of events) {
            if (event.phase) byPhase[event.phase] = (byPhase[event.phase] || 0) + 1
            if (event.errorCode) byError[event.errorCode] = (byError[event.errorCode] || 0) + 1
        }
        return {count: events.length, byPhase, byError}
    }

    function clear() { events.length = 0 }

    return Object.freeze({record, snapshot, summary, clear})
}

export {ALLOWED_FIELDS, MAX_EVENTS}
