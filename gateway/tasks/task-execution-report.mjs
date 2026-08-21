function text(value, max = 2000) {
    return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function createTaskExecutionReport(snapshot = {}, input = {}) {
    const planned = (snapshot.plan?.steps || []).slice(0, 20).map(step => ({stepId: step.stepId, phase: step.phase, role: step.role, required: step.required !== false}))
    const actual = (snapshot.plan?.steps || []).filter(step => step.status !== 'pending').slice(0, 20).map(step => ({stepId: step.stepId, phase: step.phase, role: step.role, status: step.status, summary: text(step.summary, 500)}))
    const agentFailures = Object.entries(snapshot.agents || {}).filter(([, agent]) => agent.status === 'failed').map(([agentRunId, agent]) => ({agentRunId, role: agent.role, stepId: agent.stepId}))
    const skipped = actual.filter(step => step.status === 'skipped')
    return {
        version: 1,
        taskId: text(snapshot.taskId, 240),
        turnId: text(snapshot.turnId, 240),
        status: text(snapshot.status, 40),
        plannedSteps: planned,
        actualSteps: actual,
        deviations: {
            skippedSteps: skipped,
            unfinishedSteps: planned.filter(step => !actual.some(item => item.stepId === step.stepId && ['completed', 'skipped'].includes(item.status))),
            agentFailures,
        },
        changedFiles: [...new Set((input.changedFiles || []).map(value => text(value, 1000)).filter(Boolean))].slice(0, 200),
        tests: (input.tests || []).slice(0, 100).map(item => ({name: text(item?.name || item?.command, 300), status: text(item?.status, 40), executed: item?.executed === true, evidence: text(item?.evidence, 1000)})),
        verification: snapshot.verification || {status: 'not_started', evidenceLevel: 'L0', testsExecuted: false},
        retries: (input.retries || []).slice(0, 50),
        regressions: (input.regressions || []).slice(0, 50).map(value => text(value, 1000)),
        pitfalls: (input.pitfalls || []).slice(0, 20).map(item => ({id: item.id, status: item.status, title: text(item.title, 300)})),
        skills: {requested: (input.requestedSkills || []).slice(0, 30), matched: (input.matchedSkills || []).slice(0, 30)},
        unresolvedRisks: [
            ...(snapshot.blockers || []).map(item => text(item.code || item.detail, 500)),
            ...(input.unresolvedRisks || []).map(value => text(value, 1000)),
        ].filter(Boolean).slice(0, 50),
        startedAt: Number(snapshot.startedAt) || 0,
        completedAt: Number(snapshot.completedAt) || 0,
        durationMs: Math.max(0, (Number(snapshot.completedAt) || Date.now()) - (Number(snapshot.startedAt) || Date.now())),
    }
}

export function summarizeTaskExecutionReport(report = {}) {
    return {
        taskId: report.taskId,
        status: report.status,
        steps: `${report.actualSteps?.length || 0}/${report.plannedSteps?.length || 0}`,
        changedFiles: report.changedFiles?.length || 0,
        testsExecuted: report.tests?.filter(item => item.executed).length || 0,
        evidenceLevel: report.verification?.evidenceLevel || 'L0',
        unresolvedRisks: report.unresolvedRisks?.length || 0,
        durationMs: report.durationMs || 0,
    }
}
