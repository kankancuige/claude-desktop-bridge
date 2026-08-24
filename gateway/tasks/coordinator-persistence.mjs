function coordinatorJournalPayload(snapshot, event) {
    return {
        taskId: snapshot.taskId,
        turnId: snapshot.turnId,
        status: snapshot.status,
        phase: snapshot.phase,
        revision: snapshot.revision,
        sequence: snapshot.sequence,
        eventType: String(event?.type || 'task/coordinator-state-changed').slice(0, 120),
        stepId: event?.stepId ? String(event.stepId).slice(0, 240) : null,
        role: event?.role ? String(event.role).slice(0, 80) : null,
        verification: snapshot.verification || null,
        execution: snapshot.execution || null,
        updatedAt: snapshot.updatedAt,
    }
}

function postgresProjection(snapshot) {
    return {
        coordinator: true,
        taskId: snapshot.taskId,
        turnId: snapshot.turnId,
        status: snapshot.status,
        phase: snapshot.phase,
        revision: snapshot.revision,
        sequence: snapshot.sequence,
        verification: snapshot.verification || null,
        blockers: Array.isArray(snapshot.blockers) ? snapshot.blockers.slice(-20) : [],
        findings: Array.isArray(snapshot.findings) ? snapshot.findings.slice(-20).map(item => ({id: item.id, blocking: item.blocking === true, resolved: item.resolved === true, summary: String(item.summary || '').slice(0, 400)})) : [],
        agents: Object.fromEntries(Object.entries(snapshot.agents || {}).slice(-20).map(([key, item]) => [key, {
            agentRunId: item.agentRunId, agentType: item.agentType, name: item.name, role: item.role,
            purpose: item.purpose, goal: item.goal, stepId: item.stepId, status: item.status,
            resultSummary: item.resultSummary, changedFileCount: item.changedFileCount, testCount: item.testCount,
            startedAt: item.startedAt, endedAt: item.endedAt, updatedAt: item.updatedAt,
        }])),
        workflows: snapshot.workflows || {},
        notificationIntentPersisted: snapshot.notificationIntentPersisted === true,
        startedAt: snapshot.startedAt,
        completedAt: snapshot.completedAt,
        updatedAt: snapshot.updatedAt,
    }
}

export function createCoordinatorPersistence({repository = null, shadowRepository = null, projectKeyForWorkDir, resolveJournal, onShadowError = null} = {}) {
    if (typeof projectKeyForWorkDir !== 'function' || typeof resolveJournal !== 'function') {
        throw new TypeError('Coordinator Persistence 缺少 projectKeyForWorkDir/resolveJournal')
    }
    let shadowQueue = Promise.resolve()
    const persist = (snapshot, event) => {
        if (!snapshot?.taskId || !snapshot?.plan?.workDir) return false
        const payload = coordinatorJournalPayload(snapshot, event)
        const journal = resolveJournal(snapshot.sessionId)
        if (!journal?.append) throw Object.assign(new Error('Coordinator 缺少 Session Event Journal'), {code: 'SESSION_EVENT_JOURNAL_UNAVAILABLE'})
        journal.append('task/coordinator-transition', payload, {critical: true})
        const primary = typeof repository === 'function' ? repository() : repository
        const persisted = primary?.available
            ? (primary.upsertTask || primary.recordTaskTransition).call(primary, {
            projectKey: projectKeyForWorkDir(snapshot.plan.workDir),
            taskKey: `${snapshot.taskId}:coordinator`,
            sessionId: snapshot.sessionId,
            taskId: snapshot.taskId,
            status: snapshot.status,
            phase: snapshot.phase || snapshot.status,
            modelTier: snapshot.plan.decision?.modelTier || null,
            sequence: snapshot.sequence,
            revision: snapshot.revision,
            startedAt: snapshot.startedAt,
            completedAt: snapshot.completedAt,
            updatedAt: snapshot.updatedAt,
            state: snapshot,
            eventType: payload.eventType,
            })
            : true
        const shadow = typeof shadowRepository === 'function' ? shadowRepository() : shadowRepository
        if (shadow?.upsertTask || shadow?.recordTaskTransition) {
            shadowQueue = shadowQueue.then(() => (shadow.upsertTask || shadow.recordTaskTransition).call(shadow, {
                projectKey: projectKeyForWorkDir(snapshot.plan.workDir),
                taskKey: `${snapshot.taskId}:coordinator`,
                sessionId: snapshot.sessionId,
                taskId: snapshot.taskId,
                status: snapshot.status,
                phase: snapshot.phase || snapshot.status,
                modelTier: snapshot.plan.decision?.modelTier || null,
                sequence: snapshot.sequence,
                revision: snapshot.revision,
                startedAt: snapshot.startedAt,
                completedAt: snapshot.completedAt,
                updatedAt: snapshot.updatedAt,
                state: postgresProjection(snapshot),
                eventType: payload.eventType,
            })).catch(error => onShadowError?.(error, {taskId: snapshot.taskId, revision: snapshot.revision}))
        }
        return persisted
    }
    persist.drain = () => shadowQueue
    return persist
}
