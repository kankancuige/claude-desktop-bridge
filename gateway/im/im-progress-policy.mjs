const TERMINAL_STATUSES = new Set([
    'completed', 'failed', 'blocked', 'inconclusive', 'regression_detected',
    'diagnosis_required', 'awaiting_reproduction', 'blocked_external', 'architecture_change_required',
])
const KEY_EVENTS = new Set(['task/accepted', 'phase/started', 'phase/completed', 'phase/failed', 'task/waiting-user', 'task/blocked', 'task/complete-requested'])

export function createImProgressPolicy({longTaskThresholdMs = 30_000, cooldownMs = 60_000, maxMessages = 4} = {}) {
    const state = new Map()
    return {
        evaluate(event = {}, now = Date.now()) {
            if (event.type !== 'task_coordinator_event') return {send: false, reason: 'not_coordinator_event'}
            const taskId = String(event.taskId || '')
            if (!taskId) return {send: false, reason: 'missing_task_id'}
            const current = state.get(taskId) || {startedAt: Number(event.startedAt || event.timestamp) || now, lastSentAt: 0, lastKey: '', sent: 0, terminalSent: false}
            state.set(taskId, current)
            if (TERMINAL_STATUSES.has(event.status)) {
                if (current.terminalSent) return {send: false, reason: 'terminal_duplicate'}
                current.terminalSent = true
                return {send: false, terminal: true, reason: 'final_summary_owned_by_outbox'}
            }
            if (!KEY_EVENTS.has(event.event)) return {send: false, reason: 'not_key_event'}
            if (now - current.startedAt < longTaskThresholdMs) return {send: false, reason: 'short_task'}
            const key = `${event.phase || event.status}:${event.event}`
            if (current.sent >= maxMessages) return {send: false, reason: 'limit'}
            if (key === current.lastKey) return {send: false, reason: 'duplicate_phase'}
            if (current.lastSentAt && now - current.lastSentAt < cooldownMs) return {send: false, reason: 'cooldown'}
            current.sent++
            current.lastSentAt = now
            current.lastKey = key
            return {send: true, key, sequence: current.sent}
        },
        clear(taskId) {
            state.delete(String(taskId || ''))
        },
    }
}
