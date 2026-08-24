import {createStepIdentity, createTaskIdentity} from './task-contract.mjs'
import {normalizeContinuationPolicy, normalizeExecutionMode, validateStepDependencies} from './task-execution-mode.mjs'

function boundedText(value, max = 2000) {
    return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function createTaskPlan(input = {}) {
    const identity = createTaskIdentity(input)
    const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
    const phases = Array.isArray(input.phases) ? input.phases.filter(Boolean).slice(0, 12) : []
    const executionMode = normalizeExecutionMode(input.executionMode || input.mode || (input.continueToEnd === true ? 'workflow' : 'session'))
    const continuationPolicy = normalizeContinuationPolicy(input.continuationPolicy, executionMode)
    const primaryAgentPhaseIndex = phases.indexOf('implement') >= 0 ? phases.indexOf('implement') : phases.indexOf('report')
    const steps = phases.slice(0, continuationPolicy.maxPlanSteps).map((phase, index) => ({
        ...createStepIdentity(identity.taskId, index, phase),
        dependsOn: index > 0 ? [`${identity.taskId}:step:${index}`] : [],
        role: String(input.roles?.[phase] || (phase === 'review' ? 'reviewer' : phase === 'validate' ? 'test-engineer' : phase === 'prime' ? 'explorer' : 'developer')),
        status: 'pending',
        required: phase !== 'review' || input.reviewRequired === true,
        agentRequired: index === primaryAgentPhaseIndex,
        acceptanceCriteria: (Array.isArray(input.acceptanceCriteria) ? input.acceptanceCriteria : []).slice(0, 20),
    }))
    validateStepDependencies(steps)
    return {
        version: 1,
        ...identity,
        executionMode,
        continuationPolicy,
        title: boundedText(metadata.title, 80),
        summary: boundedText(metadata.summary, 4000),
        goal: boundedText(metadata.goal || input.goal, 8000),
        requestText: boundedText(metadata.requestText, 12000),
        source: boundedText(metadata.source || input.source || identity.source, 64) || identity.source,
        workDir: boundedText(input.workDir, 1000),
        decision: input.decision && typeof input.decision === 'object' ? {...input.decision} : {},
        projectContext: input.projectContext || null,
        steps,
        createdAt: Number(input.createdAt ?? Date.now()),
    }
}
