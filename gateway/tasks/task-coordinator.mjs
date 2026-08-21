import {ACTIVE_COORDINATOR_STATUSES, COORDINATOR_STATUSES, TERMINAL_COORDINATOR_STATUSES} from './task-contract.mjs'

const STATUS_SET = new Set(COORDINATOR_STATUSES)
const PHASE_TO_STATUS = {prime: 'planning', plan: 'planning', implement: 'running', validate: 'verifying', review: 'reviewing', report: 'running'}

function clone(value) {
    return value == null ? value : structuredClone(value)
}

function nowValue(event, fallback = Date.now()) {
    return Number.isFinite(Number(event.at)) ? Number(event.at) : fallback
}

function terminalEvidenceStatus(snapshot) {
    const result = snapshot.verification?.status
    if (result === 'regression_detected') return 'regression_detected'
    if (result === 'blocked_environment') return 'blocked'
    if (result === 'inconclusive' || result === 'not_verified') return 'inconclusive'
    return null
}

export function canCompleteTask(snapshot = {}) {
    const required = (snapshot.plan?.steps || []).filter(step => step.required !== false)
    const unfinishedSteps = required.filter(step => !['completed', 'skipped'].includes(step.status))
    const activeAgents = Object.values(snapshot.agents || {}).filter(agent => ['starting', 'running'].includes(agent.status))
    const activeWorkflows = Object.values(snapshot.workflows || {}).filter(workflow => ['starting', 'running'].includes(workflow.status))
    const blockingFindings = (snapshot.findings || []).filter(item => item.blocking === true && item.resolved !== true)
    const missingAgentResults = required.filter(step => step.agentRequired === true && !Object.values(snapshot.agents || {})
        .some(agent => agent.stepId === step.stepId && agent.status === 'completed' && agent.result))
    const needsValidation = required.some(step => step.phase === 'validate')
    const validationPassed = snapshot.verification?.status === 'passed'
    const testsExecuted = snapshot.verification?.testsExecuted === true || !needsValidation
    const notificationReady = snapshot.notificationIntentPersisted !== false
    const reasons = []
    if (unfinishedSteps.length) reasons.push('required_steps_unfinished')
    if (activeAgents.length) reasons.push('active_agents')
    if (activeWorkflows.length) reasons.push('active_workflows')
    if (blockingFindings.length) reasons.push('blocking_findings')
    if (missingAgentResults.length) reasons.push('agent_result_missing')
    if (needsValidation && !validationPassed) reasons.push('verification_not_passed')
    if (!testsExecuted) reasons.push('tests_not_executed')
    if (!notificationReady) reasons.push('notification_intent_not_persisted')
    return {allowed: reasons.length === 0, reasons}
}

export function createTaskSnapshot({plan, now = Date.now()} = {}) {
    if (!plan?.taskId) throw new TypeError('Coordinator 需要有效 TaskPlan')
    return {
        version: 1,
        taskId: plan.taskId,
        turnId: plan.turnId,
        sessionId: plan.sessionId,
        source: plan.source,
        userId: plan.userId || null,
        status: 'accepted',
        phase: null,
        revision: 1,
        sequence: 0,
        plan: clone(plan),
        agents: {},
        workflows: {},
        findings: [],
        verification: {status: 'not_started', evidenceLevel: 'L0', testsExecuted: false},
        blockers: [],
        notificationIntentPersisted: false,
        startedAt: now,
        completedAt: 0,
        updatedAt: now,
        lastEventId: null,
    }
}

function setStepStatus(snapshot, event, status) {
    const step = snapshot.plan.steps.find(item => item.stepId === event.stepId)
    if (step) {
        step.status = status
        step.updatedAt = nowValue(event, snapshot.updatedAt)
        if (event.summary) step.summary = String(event.summary).slice(0, 2000)
    }
}

export function transitionTask(current, event = {}) {
    if (!current?.taskId || !event?.type) return current
    const eventTaskId = event.taskId ? String(event.taskId) : current.taskId
    if (eventTaskId !== current.taskId) return current
    const expectedRevision = current.revision + 1
    const eventRevision = Number.isFinite(Number(event.revision)) ? Number(event.revision) : expectedRevision
    if (eventRevision <= current.revision || eventRevision !== expectedRevision) return current
    // 执行报告必须基于最终状态生成；允许报告作为终态后的只读投影附加，
    // 其他迟到事件仍不能改写已经落定的任务结果。
    if (TERMINAL_COORDINATOR_STATUSES.has(current.status) && !['task/resumed', 'report/generated', 'rca/completed'].includes(event.type)) return current
    const next = clone(current)
    next.revision = eventRevision
    next.sequence = Math.max(next.sequence + 1, Number(event.sequence) || 0)
    next.updatedAt = nowValue(event, next.updatedAt)
    next.lastEventId = event.eventId ? String(event.eventId).slice(0, 240) : null

    switch (event.type) {
        case 'phase/started':
            next.phase = String(event.phase || '')
            next.status = PHASE_TO_STATUS[next.phase] || 'running'
            setStepStatus(next, event, 'running')
            break
        case 'phase/completed':
            setStepStatus(next, event, 'completed')
            break
        case 'phase/skipped':
            setStepStatus(next, event, 'skipped')
            break
        case 'phase/failed':
            setStepStatus(next, event, 'failed')
            next.status = 'failed'
            next.blockers.push({code: event.code || 'phase_failed', detail: String(event.detail || '').slice(0, 1000)})
            next.completedAt = next.updatedAt
            break
        case 'task/status':
            if (STATUS_SET.has(event.status)) {
                next.status = event.status
                next.completedAt = TERMINAL_COORDINATOR_STATUSES.has(event.status) ? next.updatedAt : 0
            }
            break
        case 'task/waiting-user':
            next.status = 'waiting_user'
            next.blockers = [{code: 'waiting_user', detail: String(event.detail || '').slice(0, 1000)}]
            break
        case 'task/paused':
            next.status = 'paused'
            next.completedAt = next.updatedAt
            break
        case 'task/blocked':
            next.status = 'blocked'
            next.blockers.push({code: event.code || 'blocked', detail: String(event.detail || '').slice(0, 1000)})
            next.completedAt = next.updatedAt
            break
        case 'task/resumed':
            next.status = event.status && STATUS_SET.has(event.status) ? event.status : 'running'
            next.blockers = []
            next.completedAt = 0
            break
        case 'agent/started':
        case 'agent/completed':
        case 'agent/failed': {
            const id = String(event.agentRunId || '')
            const status = event.type === 'agent/started' ? 'running' : event.type.split('/')[1]
            if (id) next.agents[id] = {
                ...(next.agents[id] || {}), role: event.role || 'developer', stepId: event.stepId || null,
                status, result: event.result ? clone(event.result) : next.agents[id]?.result || null, updatedAt: next.updatedAt,
            }
            break
        }
        case 'workflow/started':
        case 'workflow/completed':
        case 'workflow/failed': {
            const id = String(event.workflowId || '')
            const status = event.type === 'workflow/started' ? 'running' : event.type.split('/')[1]
            if (id) next.workflows[id] = {...(next.workflows[id] || {}), status, updatedAt: next.updatedAt}
            break
        }
        case 'verification/result':
            next.verification = {
                status: String(event.status || 'inconclusive'),
                evidenceLevel: String(event.evidenceLevel || 'L0'),
                testsExecuted: event.testsExecuted === true,
                summary: String(event.summary || '').slice(0, 2000),
                campaignId: event.campaignId ? String(event.campaignId).slice(0, 240) : null,
                results: (Array.isArray(event.results) ? event.results : []).slice(0, 100).map(item => ({
                    scenarioId: String(item?.scenarioId || '').slice(0, 240),
                    kind: String(item?.kind || '').slice(0, 40),
                    passed: item?.passed === true,
                    exitCode: Number.isFinite(Number(item?.exitCode)) ? Number(item.exitCode) : null,
                    round: Math.max(1, Number(item?.round) || 1),
                })),
            }
            break
        case 'finding/recorded':
            next.findings.push({id: String(event.findingId || `${next.taskId}:${next.findings.length + 1}`), blocking: event.blocking === true, resolved: false, summary: String(event.summary || '').slice(0, 1000)})
            break
        case 'finding/resolved': {
            const finding = next.findings.find(item => item.id === event.findingId)
            if (finding) finding.resolved = true
            break
        }
        case 'report/generated':
            next.executionReport = clone(event.report || null)
            break
        case 'rca/completed':
            next.rootCauseAnalysis = clone(event.result || null)
            if (STATUS_SET.has(event.status)) next.status = event.status
            next.completedAt = TERMINAL_COORDINATOR_STATUSES.has(next.status) ? next.updatedAt : 0
            break
        case 'notification/intent-persisted':
            next.notificationIntentPersisted = event.persisted === true
            break
        case 'task/complete-requested': {
            const evidenceStatus = terminalEvidenceStatus(next)
            const gate = canCompleteTask(next)
            if (evidenceStatus) next.status = evidenceStatus
            else if (gate.allowed) next.status = 'completed'
            else {
                next.status = 'inconclusive'
                next.blockers.push({code: 'completion_gate_rejected', detail: gate.reasons.join(',')})
            }
            next.completedAt = next.updatedAt
            break
        }
        default:
            return current
    }
    return next
}

export function createTaskCoordinator({persist = () => {}, publish = () => {}, now = () => Date.now()} = {}) {
    const tasks = new Map()
    const commit = (snapshot, event) => {
        tasks.set(snapshot.taskId, snapshot)
        persist(clone(snapshot), clone(event))
        publish(clone(snapshot), clone(event))
        return clone(snapshot)
    }
    return {
        accept(plan) {
            const existing = tasks.get(plan?.taskId)
            if (existing) return clone(existing)
            const snapshot = createTaskSnapshot({plan, now: now()})
            return commit(snapshot, {type: 'task/accepted', taskId: snapshot.taskId, revision: snapshot.revision, at: snapshot.updatedAt})
        },
        restore(snapshot) {
            if (!snapshot?.taskId) return null
            tasks.set(snapshot.taskId, clone(snapshot))
            return clone(snapshot)
        },
        transition(taskId, event) {
            const current = tasks.get(String(taskId || ''))
            if (!current) return null
            const next = transitionTask(current, event)
            if (next === current) return clone(current)
            return commit(next, {...event, taskId: current.taskId, revision: next.revision, sequence: next.sequence})
        },
        getTaskSnapshot(taskId) {
            return clone(tasks.get(String(taskId || '')) || null)
        },
        dispatchTask(taskId) {
            const snapshot = tasks.get(String(taskId || ''))
            if (!snapshot) return null
            const nextStep = snapshot.plan.steps.find(step => step.status === 'pending')
            if (!nextStep) return clone(snapshot)
            return this.transition(taskId, {type: 'phase/started', phase: nextStep.phase, stepId: nextStep.stepId, role: nextStep.role})
        },
        isActive(taskId) {
            return ACTIVE_COORDINATOR_STATUSES.has(tasks.get(String(taskId || ''))?.status)
        },
    }
}
