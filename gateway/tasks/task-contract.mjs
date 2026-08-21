import {randomUUID} from 'node:crypto'

export const COORDINATOR_STATUSES = Object.freeze([
    'accepted', 'planning', 'running', 'verifying', 'reviewing', 'waiting_user',
    'paused', 'blocked', 'inconclusive', 'completed', 'failed', 'regression_detected',
    'diagnosis_required', 'awaiting_reproduction', 'blocked_external', 'architecture_change_required',
])

export const TERMINAL_COORDINATOR_STATUSES = new Set([
    'paused', 'blocked', 'inconclusive', 'completed', 'failed', 'regression_detected',
    'diagnosis_required', 'awaiting_reproduction', 'blocked_external', 'architecture_change_required',
])
export const ACTIVE_COORDINATOR_STATUSES = new Set(['accepted', 'planning', 'running', 'verifying', 'reviewing', 'waiting_user'])

export function createTaskIdentity(input = {}) {
    const taskId = String(input.taskId || randomUUID())
    return {
        taskId,
        turnId: String(input.turnId || randomUUID()),
        sessionId: String(input.sessionId || ''),
        source: String(input.source || 'desktop'),
        userId: input.userId ? String(input.userId).slice(0, 256) : null,
    }
}

export function createStepIdentity(taskId, index, phase) {
    return {taskId: String(taskId), stepId: `${taskId}:step:${index + 1}`, phase: String(phase)}
}

export function createAgentRunIdentity(stepId, attempt = 1) {
    return `${stepId}:agent:${Math.max(1, Math.trunc(Number(attempt) || 1))}`
}
