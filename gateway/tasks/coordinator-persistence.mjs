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
        updatedAt: snapshot.updatedAt,
    }
}

export function createCoordinatorPersistence({stateStore, projectKeyForWorkDir, resolveJournal} = {}) {
    if (typeof projectKeyForWorkDir !== 'function' || typeof resolveJournal !== 'function') {
        throw new TypeError('Coordinator Persistence 缺少 projectKeyForWorkDir/resolveJournal')
    }
    return (snapshot, event) => {
        if (!snapshot?.taskId || !snapshot?.plan?.workDir) return false
        const payload = coordinatorJournalPayload(snapshot, event)
        const journal = resolveJournal(snapshot.sessionId)
        if (!journal?.append) throw Object.assign(new Error('Coordinator 缺少 Session Event Journal'), {code: 'SESSION_EVENT_JOURNAL_UNAVAILABLE'})
        journal.append('task/coordinator-transition', payload, {critical: true})
        if (!stateStore?.available) return true
        return stateStore.recordTaskTransition({
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
    }
}
