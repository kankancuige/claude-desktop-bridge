import {createStepIdentity, createTaskIdentity} from './task-contract.mjs'

function boundedText(value, max = 2000) {
    return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function createTaskPlan(input = {}) {
    const identity = createTaskIdentity(input)
    const phases = Array.isArray(input.phases) ? input.phases.filter(Boolean).slice(0, 12) : []
    const primaryAgentPhaseIndex = phases.indexOf('implement') >= 0 ? phases.indexOf('implement') : phases.indexOf('report')
    const steps = phases.map((phase, index) => ({
        ...createStepIdentity(identity.taskId, index, phase),
        role: String(input.roles?.[phase] || (phase === 'review' ? 'reviewer' : phase === 'validate' ? 'test-engineer' : phase === 'prime' ? 'explorer' : 'developer')),
        status: 'pending',
        required: phase !== 'review' || input.reviewRequired === true,
        agentRequired: index === primaryAgentPhaseIndex,
        acceptanceCriteria: (Array.isArray(input.acceptanceCriteria) ? input.acceptanceCriteria : []).slice(0, 20),
    }))
    return {
        version: 1,
        ...identity,
        goal: boundedText(input.goal, 8000),
        workDir: boundedText(input.workDir, 1000),
        decision: input.decision && typeof input.decision === 'object' ? {...input.decision} : {},
        projectContext: input.projectContext || null,
        steps,
        createdAt: Number(input.createdAt ?? Date.now()),
    }
}
