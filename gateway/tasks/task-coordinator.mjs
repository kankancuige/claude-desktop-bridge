import {ACTIVE_COORDINATOR_STATUSES, COORDINATOR_STATUSES, TERMINAL_COORDINATOR_STATUSES} from './task-contract.mjs'
import {createTaskRunBudget} from './task-execution-mode.mjs'

const STATUS_SET = new Set(COORDINATOR_STATUSES)
const PHASE_TO_STATUS = {prime: 'planning', plan: 'planning', implement: 'running', validate: 'verifying', review: 'reviewing', report: 'running'}

function clone(value) {
    return value == null ? value : structuredClone(value)
}

function nowValue(event, fallback = Date.now()) {
    return Number.isFinite(Number(event.at)) ? Number(event.at) : fallback
}

function boundedText(value, max = 240) {
    return typeof value === 'string' ? value.replace(/[\0\r\n]+/g, ' ').trim().slice(0, max) : ''
}

function agentProjection(event, previous = {}, updatedAt) {
    const result = event.result && typeof event.result === 'object' ? event.result : null
    const status = event.statusOverride || (event.type === 'agent/started' ? 'running' : event.type.split('/')[1])
    const startedAt = previous.startedAt || (status === 'running' ? updatedAt : null)
    const endedAt = ['completed', 'failed', 'blocked', 'inconclusive', 'cancelled'].includes(status) ? updatedAt : previous.endedAt || null
    return {
        ...previous,
        agentRunId: boundedText(event.agentRunId, 240),
        agentType: boundedText(event.agentType || previous.agentType || event.role, 120),
        name: boundedText(event.name || previous.name || event.agentType || event.role || 'Agent', 120),
        role: boundedText(event.role || previous.role || 'developer', 80),
        purpose: boundedText(event.purpose || previous.purpose || `执行 ${event.role || event.agentType || 'Agent'} 专项任务。`, 240),
        goal: boundedText(event.goal || previous.goal, 240),
        stepId: boundedText(event.stepId || previous.stepId, 240) || null,
        status,
        result: result ? clone(result) : previous.result || null,
        resultSummary: boundedText(result?.summary || previous.resultSummary, 400),
        writeRequest: result?.writeRequest ? clone(result.writeRequest) : previous.writeRequest || null,
        changedFileCount: Array.isArray(result?.changedFiles) ? Math.min(result.changedFiles.length, 200) : Number(previous.changedFileCount || 0),
        testCount: Array.isArray(result?.tests) ? Math.min(result.tests.length, 50) : Number(previous.testCount || 0),
        startedAt,
        endedAt,
        updatedAt,
    }
}

function appendAgentTimeline(snapshot, event, agent) {
    const timeline = Array.isArray(snapshot.timeline) ? snapshot.timeline : []
    timeline.push({
        type: event.type,
        agentRunId: agent.agentRunId,
        agentType: agent.agentType,
        name: agent.name,
        stepId: agent.stepId,
        status: agent.status,
        summary: agent.resultSummary || agent.purpose,
        at: agent.updatedAt,
    })
    snapshot.timeline = timeline.slice(-40)
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
    const failedWorkflows = Object.values(snapshot.workflows || {}).filter(workflow => ['failed', 'interrupted'].includes(workflow.status))
    const blockingFindings = (snapshot.findings || []).filter(item => item.blocking === true && item.resolved !== true)
    const missingAgentResults = required.filter(step => step.agentRequired === true && !Object.values(snapshot.agents || {})
        .some(agent => agent.stepId === step.stepId && agent.status === 'completed' && agent.result))
    const pendingAgentWrites = Object.values(snapshot.agents || {}).filter(agent => agent.status === 'blocked' && agent.writeRequest)
    const needsValidation = required.some(step => step.phase === 'validate')
    const validationPassed = snapshot.verification?.status === 'passed'
    const testsExecuted = snapshot.verification?.testsExecuted === true || !needsValidation
    const notificationReady = snapshot.notificationIntentPersisted !== false
    const reasons = []
    if (unfinishedSteps.length) reasons.push('required_steps_unfinished')
    if (activeAgents.length) reasons.push('active_agents')
    if (activeWorkflows.length) reasons.push('active_workflows')
    if (failedWorkflows.length) reasons.push('failed_workflows')
    if (blockingFindings.length) reasons.push('blocking_findings')
    if (missingAgentResults.length) reasons.push('agent_result_missing')
    if (pendingAgentWrites.length) reasons.push('agent_write_delegation_pending')
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
        execution: {
            mode: String(plan.executionMode || 'session'),
            currentStepId: null,
            completedStepCount: 0,
            totalStepCount: Array.isArray(plan.steps) ? plan.steps.length : 0,
            continuationCount: 0,
            budget: createTaskRunBudget(plan.continuationPolicy || {}, plan.executionMode || 'session'),
        },
        agents: {},
        workflows: {},
        timeline: [],
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
        if (status === 'running') snapshot.execution.currentStepId = step.stepId
        if (status === 'completed' || status === 'skipped') {
            snapshot.execution.completedStepCount = snapshot.plan.steps.filter(item => ['completed', 'skipped'].includes(item.status)).length
            if (snapshot.execution.currentStepId === step.stepId) snapshot.execution.currentStepId = null
        }
    }
}

function readyPendingStep(snapshot) {
    return snapshot?.plan?.steps?.find(step => step.status === 'pending' && (Array.isArray(step.dependsOn) ? step.dependsOn : []).every(dependency => {
        const prerequisite = snapshot.plan.steps.find(item => item.stepId === dependency)
        return prerequisite && ['completed', 'skipped'].includes(prerequisite.status)
    })) || null
}

function stepFor(snapshot, stepId) {
    return snapshot?.plan?.steps?.find(step => step.stepId === String(stepId || '')) || null
}

function dependenciesComplete(snapshot, step) {
    return (Array.isArray(step?.dependsOn) ? step.dependsOn : []).every(dependency => {
        const prerequisite = stepFor(snapshot, dependency)
        return prerequisite && ['completed', 'skipped'].includes(prerequisite.status)
    })
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
            if (!stepFor(next, event.stepId) || !dependenciesComplete(next, stepFor(next, event.stepId))) return current
            if (next.execution.currentStepId && next.execution.currentStepId !== String(event.stepId)) return current
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
            if (id) {
                next.agents[id] = agentProjection(event, next.agents[id], next.updatedAt)
                appendAgentTimeline(next, event, next.agents[id])
            }
            break
        }
        case 'agent/blocked': {
            const id = String(event.agentRunId || '')
            if (id) {
                next.agents[id] = agentProjection(event, next.agents[id], next.updatedAt)
                appendAgentTimeline(next, event, next.agents[id])
            }
            break
        }
        case 'agent/write-resolved': {
            const id = String(event.agentRunId || '')
            if (id) {
                next.agents[id] = agentProjection({...event, statusOverride: 'completed'}, next.agents[id], next.updatedAt)
                appendAgentTimeline(next, event, next.agents[id])
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
    const transition = (taskId, event) => {
        const current = tasks.get(String(taskId || ''))
        if (!current) return null
        const next = transitionTask(current, event)
        if (next === current) return clone(current)
        return commit(next, {...event, taskId: current.taskId, revision: next.revision, sequence: next.sequence})
    }
    const dispatchTask = taskId => {
        const snapshot = tasks.get(String(taskId || ''))
        if (!snapshot) return null
        const nextStep = readyPendingStep(snapshot)
        if (!nextStep) return clone(snapshot)
        return transition(taskId, {type: 'phase/started', phase: nextStep.phase, stepId: nextStep.stepId, role: nextStep.role})
    }
    const startPlannedTask = ({taskId} = {}) => {
        const snapshot = tasks.get(String(taskId || ''))
        if (!snapshot) return null
        if (TERMINAL_COORDINATOR_STATUSES.has(snapshot.status)) return clone(snapshot)
        return dispatchTask(snapshot.taskId)
    }
    const advancePlannedTask = ({taskId, stepId, result = {}, evidence = null} = {}) => {
        const snapshot = tasks.get(String(taskId || ''))
        if (!snapshot) return {nextStepId: null, status: 'not_found', reasons: ['task_not_found'], snapshot: null}
        const step = stepFor(snapshot, stepId)
        if (!step) return {nextStepId: null, status: snapshot.status, reasons: ['step_not_found'], snapshot: clone(snapshot)}
        if (snapshot.execution.currentStepId !== step.stepId) return {nextStepId: snapshot.execution.currentStepId, status: snapshot.status, reasons: ['step_not_current'], snapshot: clone(snapshot)}
        if (result?.status === 'blocked' || result?.blocked === true) {
            const paused = transition(snapshot.taskId, {type: 'task/blocked', code: result.code || 'step_blocked', detail: result.summary || result.reason || '步骤阻塞'})
            return {nextStepId: step.stepId, status: paused.status, reasons: ['step_blocked'], snapshot: paused}
        }
        if (result?.waitingForEvent === true) {
            const paused = transition(snapshot.taskId, {type: 'task/waiting-user', detail: result.summary || '等待外部事件'})
            return {nextStepId: step.stepId, status: paused.status, reasons: ['waiting_for_event'], snapshot: paused}
        }
        const passed = result?.status === 'completed' || result?.completed === true || evidence?.passed === true
        if (!passed) return {nextStepId: step.stepId, status: snapshot.status, reasons: ['acceptance_not_met'], snapshot: clone(snapshot)}
        const completed = transition(snapshot.taskId, {type: 'phase/completed', phase: step.phase, stepId: step.stepId, summary: result.summary || evidence?.summary || ''})
        const nextStep = readyPendingStep(completed)
        const next = nextStep ? dispatchTask(completed.taskId) : completed
        return {nextStepId: nextStep?.stepId || null, status: next.status, reasons: [], snapshot: next}
    }
    const pausePlannedTask = ({taskId, reason = 'manual_pause'} = {}) => transition(taskId, {type: 'task/paused', detail: boundedText(reason, 400)})
    const resumePlannedTask = ({taskId} = {}) => {
        let snapshot = transition(taskId, {type: 'task/resumed'})
        if (!snapshot || snapshot.execution?.currentStepId) return snapshot
        snapshot = dispatchTask(taskId)
        return snapshot
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
            return transition(taskId, event)
        },
        getTaskSnapshot(taskId) {
            return clone(tasks.get(String(taskId || '')) || null)
        },
        dispatchTask(taskId) {
            return dispatchTask(taskId)
        },
        startPlannedTask,
        advancePlannedTask,
        pausePlannedTask,
        resumePlannedTask,
        isActive(taskId) {
            return ACTIVE_COORDINATOR_STATUSES.has(tasks.get(String(taskId || ''))?.status)
        },
    }
}
