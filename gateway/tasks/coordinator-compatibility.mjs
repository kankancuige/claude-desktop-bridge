import {createTaskSnapshot} from './task-coordinator.mjs'

const RECOVERABLE_STATUSES = new Set([
    'accepted', 'planning', 'running', 'verifying', 'reviewing', 'waiting_user',
    'paused', 'blocked', 'inconclusive', 'completed', 'failed', 'regression_detected',
    'diagnosis_required', 'awaiting_reproduction', 'blocked_external', 'architecture_change_required',
])
const ACTIVE_RECOVERY_STATUSES = new Set(['accepted', 'planning', 'running', 'verifying', 'reviewing'])

function successResult(event = {}) {
    return event?.type === 'primary_result' && event?.result?.outcome === 'succeeded'
}

function requiredSteps(snapshot = {}) {
    return Array.isArray(snapshot.plan?.steps) ? snapshot.plan.steps.filter(step => step.required !== false) : []
}

function nextRevision(snapshot, offset = 1) {
    return Number(snapshot?.revision || 0) + offset
}

function eventFor(snapshot, type, payload = {}, offset = 1) {
    return {taskId: snapshot.taskId, type, revision: nextRevision(snapshot, offset), ...payload}
}

function stepEvents(snapshot, predicate, status = 'phase/completed', summary = '') {
    const events = []
    let offset = 1
    for (const step of requiredSteps(snapshot)) {
        if (!predicate(step)) continue
        if (['completed', 'skipped'].includes(step.status)) continue
        events.push(eventFor(snapshot, status, {
            phase: step.phase,
            stepId: step.stepId,
            role: step.role,
            summary,
        }, offset++))
    }
    return events
}

function firstStep(snapshot, phase) {
    return requiredSteps(snapshot).find(step => step.phase === phase && step.status === 'pending') || null
}

/**
 * 旧 SDK/Workflow 完成事件仍会抵达 Gateway；这里仅将它们投影为 Coordinator 事件。
 * 这样兼容层不能自行宣布主任务完成，最终状态仍由 Completion Gate 决定。
 */
export function mapLegacyCompletionToCoordinator(snapshot, legacyEvent = {}) {
    if (!snapshot?.taskId || !legacyEvent?.type) return []
    const events = []
    if (successResult(legacyEvent)) {
        events.push(...stepEvents(snapshot, step => ['prime', 'plan', 'implement'].includes(step.phase), 'phase/completed', '主会话已完成该执行阶段'))
        const validate = firstStep(snapshot, 'validate')
        if (validate) {
            events.push(eventFor(snapshot, 'phase/started', {phase: 'validate', stepId: validate.stepId, role: validate.role}, events.length + 1))
        } else {
            const review = firstStep(snapshot, 'review')
            if (review) events.push(eventFor(snapshot, 'phase/started', {phase: 'review', stepId: review.stepId, role: review.role}, events.length + 1))
            else events.push(...stepEvents({...snapshot, revision: nextRevision(snapshot, events.length)}, step => step.phase === 'report', 'phase/completed', '主会话已生成最终报告'))
        }
        return normalizeRevisions(snapshot, events)
    }
    if (legacyEvent.type === 'review_result' && legacyEvent.outcome?.passed === true) {
        events.push(...stepEvents(snapshot, step => step.phase === 'review', 'phase/completed', '最终审查通过'))
        events.push(...stepEvents({...snapshot, revision: nextRevision(snapshot, events.length)}, step => step.phase === 'report', 'phase/completed', '已生成最终报告'))
        return normalizeRevisions(snapshot, events)
    }
    if (legacyEvent.type === 'review_result' && legacyEvent.outcome?.passed === false) {
        const findings = Array.isArray(legacyEvent.outcome?.blockingFindings) ? legacyEvent.outcome.blockingFindings : []
        return normalizeRevisions(snapshot, findings.map((finding, index) => eventFor(snapshot, 'finding/recorded', {
            findingId: `${snapshot.taskId}:review:${index + 1}`,
            blocking: true,
            summary: finding.title || finding.description || '最终审查发现阻断问题',
        }, index + 1)))
    }
    if (legacyEvent.type === 'runtime_failed') {
        return [eventFor(snapshot, 'task/blocked', {code: 'runtime_failed', detail: legacyEvent.detail || '任务执行异常中断'})]
    }
    if (legacyEvent.type === 'review_error') {
        return [eventFor(snapshot, 'task/blocked', {code: 'review_error', detail: legacyEvent.detail || '最终审查执行失败'})]
    }
    if (legacyEvent.type === 'review_paused' || legacyEvent.type === 'user_stopped') {
        return [eventFor(snapshot, 'task/paused', {detail: legacyEvent.detail || '任务已暂停'})]
    }
    return []
}

export function mapVerificationToCoordinator(snapshot, verification = {}) {
    if (!snapshot?.taskId) return []
    const events = [eventFor(snapshot, 'verification/result', {
        status: verification.status || 'inconclusive',
        evidenceLevel: verification.evidenceLevel || 'L0',
        testsExecuted: verification.testsExecuted === true,
        summary: verification.summary || '',
    })]
    if (verification.status === 'passed') {
        const afterVerification = {...snapshot, revision: nextRevision(snapshot, events.length)}
        events.push(...stepEvents(afterVerification, step => step.phase === 'validate', 'phase/completed', verification.summary || '验证通过'))
        const review = firstStep(afterVerification, 'review')
        if (review) events.push(eventFor(afterVerification, 'phase/started', {phase: 'review', stepId: review.stepId, role: review.role}, events.length + 1))
        else events.push(...stepEvents({...afterVerification, revision: nextRevision(afterVerification, events.length)}, step => step.phase === 'report', 'phase/completed', '已生成最终报告'))
    }
    return normalizeRevisions(snapshot, events)
}

function normalizeRevisions(snapshot, events) {
    return events.map((event, index) => ({...event, revision: nextRevision(snapshot, index + 1)}))
}

export function restoreCoordinatorSnapshot(record, {workDir = '', source = 'desktop', now = Date.now()} = {}) {
    const state = record?.state
    const projection = state?.coordinator
    const taskId = String(state?.taskId || record?.taskId || '').trim()
    if (!projection || !taskId || !Array.isArray(projection.steps)) return null
    const plan = {
        version: 1,
        taskId,
        turnId: String(state.turnId || ''),
        sessionId: String(record.sessionId || ''),
        source: String(source || 'desktop'),
        userId: null,
        goal: '',
        workDir: String(workDir || ''),
        decision: {},
        projectContext: null,
        steps: projection.steps.slice(0, 12).map(step => ({
            stepId: String(step.stepId || ''),
            taskId,
            phase: String(step.phase || ''),
            role: String(step.role || 'developer'),
            status: step.status === 'running' ? 'pending' : String(step.status || 'pending'),
            required: step.required !== false,
            agentRequired: step.agentRequired === true,
            acceptanceCriteria: [],
        })),
        createdAt: Number(record.startedAt || state.startedAt || now),
    }
    const snapshot = createTaskSnapshot({plan, now: Number(record.startedAt || state.startedAt || now)})
    const persistedStatus = RECOVERABLE_STATUSES.has(record.status) ? record.status : 'inconclusive'
    const interrupted = ACTIVE_RECOVERY_STATUSES.has(persistedStatus)
    snapshot.status = interrupted ? 'inconclusive' : persistedStatus
    snapshot.phase = projection.phase || record.phase || null
    snapshot.revision = Math.max(1, Number(projection.revision || record.revision || 1))
    snapshot.sequence = Math.max(0, Number(state.sequence || record.sequence || 0))
    snapshot.agents = Object.fromEntries(Object.entries(projection.agents || {}).map(([id, agent]) => [id, {
        ...agent,
        status: ['starting', 'running'].includes(agent?.status) ? 'interrupted' : agent?.status,
    }]))
    snapshot.workflows = Object.fromEntries(Object.entries(projection.workflows || {}).map(([id, workflow]) => [id, {
        ...workflow,
        status: ['starting', 'running'].includes(workflow?.status) ? 'interrupted' : workflow?.status,
    }]))
    snapshot.verification = projection.verification || snapshot.verification
    snapshot.blockers = (projection.blockerCodes || []).map(code => ({code: String(code), detail: ''}))
    if (interrupted) snapshot.blockers.push({code: 'coordinator_restart_interrupted', detail: 'Gateway 重启中断了活动任务，需要显式继续并重新验证。'})
    snapshot.notificationIntentPersisted = projection.notificationIntentPersisted === true
    snapshot.startedAt = Number(record.startedAt || state.startedAt || now)
    snapshot.completedAt = interrupted ? Number(now) : Number(record.completedAt || state.completedAt || 0)
    snapshot.updatedAt = Number(record.updatedAt || state.updatedAt || now)
    return snapshot
}
