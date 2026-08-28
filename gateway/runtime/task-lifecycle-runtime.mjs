/** 任务状态、完成转换和生命周期快照端口。 */
import {createTaskMetadata} from '../tasks/task-metadata.mjs'

export function createTaskLifecycleRuntime({
    sessions,
    createTaskStatePatch,
    saveTaskState,
    appendSessionEvent,
    journalTaskState,
    persistTaskStateProjection,
    createTaskCompletionState,
    taskStateForError,
    taskStateForStop,
    resolveTaskPhases,
    buildProjectContext,
    resolveTaskAgents,
    createTaskPlan,
    getTaskWorkbench,
    getTaskCoordinator,
    resolveRequiredNotificationPlatforms,
    transitionTaskCompletion,
    getSessionWorkflowStates,
    getSessionRuntimeState,
    hasPendingTaskWorkflow,
    taskStateForSessionClient,
    getTaskStateForSessionClient = () => taskStateForSessionClient,
    createTaskLifecycleSnapshot,
    getBroadcastDesktop,
    logger = {debug() {}, warn() {}},
} = {}) {
    if (!sessions || typeof createTaskStatePatch !== 'function' || typeof saveTaskState !== 'function'
        || typeof appendSessionEvent !== 'function' || typeof journalTaskState !== 'function'
        || typeof persistTaskStateProjection !== 'function' || typeof createTaskCompletionState !== 'function'
        || typeof taskStateForError !== 'function' || typeof taskStateForStop !== 'function'
        || typeof resolveTaskPhases !== 'function' || typeof buildProjectContext !== 'function'
        || typeof resolveTaskAgents !== 'function' || typeof createTaskPlan !== 'function'
        || typeof getTaskWorkbench !== 'function' || typeof getTaskCoordinator !== 'function'
        || typeof resolveRequiredNotificationPlatforms !== 'function' || typeof transitionTaskCompletion !== 'function'
        || typeof getSessionWorkflowStates !== 'function' || typeof getSessionRuntimeState !== 'function'
        || typeof hasPendingTaskWorkflow !== 'function' || typeof getTaskStateForSessionClient !== 'function'
        || typeof createTaskLifecycleSnapshot !== 'function' || typeof getBroadcastDesktop !== 'function') {
        throw new TypeError('task lifecycle dependencies are required')
    }

    function updateTaskState(session, sessionId, next) {
        if (!session) return null
        session.taskState = createTaskStatePatch({
            // 任务元数据在首个状态投影后仍需贯穿完成、暂停、超时和通知更新，避免后续状态覆盖标题。
            ...(session.taskMetadata && typeof session.taskMetadata === 'object' ? session.taskMetadata : {}),
            ...(session.taskState && typeof session.taskState === 'object' ? session.taskState : {}),
            ...(next && typeof next === 'object' ? next : {}),
            permissionMode: next?.permissionMode || session.permissionMode || session.taskState?.permissionMode || 'default',
            model: next?.model || session.queryOpts?.model || session.taskState?.model || null,
        })
        saveTaskState(session, sessionId)
        appendSessionEvent(session, 'task/state-changed', {taskState: journalTaskState(session.taskState)})
        session._taskStateRevision = Math.max(Number(session._taskStateRevision || 0) + 1, Number(session.taskState.updatedAt || 0))
        persistTaskStateProjection(session, sessionId, session.taskState)
        return session.taskState
    }

    function taskStateFromCompletion(session, detail = '') {
        const completion = createTaskCompletionState(session?.taskCompletion)
        const reviewOutcome = completion.reviewOutcome || {}
        const status = completion.phase === 'fixing' ? 'fixing' : completion.phase
        const startedAt = Number(session?.taskStartedAt || session?.taskState?.startedAt || 0)
        const terminal = ['succeeded', 'failed', 'incomplete', 'review_paused', 'stopped', 'interrupted'].includes(status)
        const completedAt = terminal ? Number(session?.taskCompletedAt || Date.now()) : 0
        return createTaskStatePatch({
            ...(session?.taskMetadata && typeof session.taskMetadata === 'object' ? session.taskMetadata : {}),
            ...(session?.taskState && typeof session.taskState === 'object' ? session.taskState : {}),
            status,
            outcome: status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : status === 'incomplete' ? 'incomplete' : null,
            continuationReason: status === 'failed' || status === 'review_paused'
                ? 'execution_error'
                : status === 'incomplete'
                    ? completion.primaryResult?.continuationReason
                        || (/写入权限|write_permission_required/i.test(String(detail || completion.detail || '')) ? 'write_permission_required' : null)
                    : null,
            resumable: !['succeeded'].includes(status) && Boolean(session?.lastSessionId || session?._hasConversation),
            subtype: session?.lastTaskResult?.subtype || null,
            detail: detail || completion.detail || session?.lastTaskResult?.result || '',
            numTurns: session?.lastTaskResult?.numTurns || 0,
            startedAt,
            completedAt,
            durationMs: startedAt && completedAt ? Math.max(0, completedAt - startedAt) : 0,
            finalReplyText: session?.taskFinalReplyText || session?.taskState?.finalReplyText || '',
            finalReplyAvailable: Boolean(session?.taskFinalReplyText || session?.taskState?.finalReplyText),
            notifications: session?.taskState?.notifications || {},
            writeRequests: session?._pendingAgentWriteRequests || session?.taskState?.writeRequests || [],
            permissionMode: session?.permissionMode || session?.taskState?.permissionMode || 'default',
            model: session?.queryOpts?.model || session?.taskState?.model || null,
            sdkSessionId: session?.lastSessionId,
            historySessionId: session?.lastSessionId,
            taskId: session?.taskCompletionTaskId || null,
            turnId: session?.taskCompletionTurnId || null,
            sequence: session?._taskCompletionSequence || 0,
            review: {
                round: completion.reviewRound,
                tier: completion.reviewPlan?.tier || null,
                summary: reviewOutcome.summary || completion.detail || '',
                blockingFindings: reviewOutcome.blockingFindings || [],
            },
        })
    }

    function updateTaskNotificationState(session, sessionId, platform, state, notificationId, lastError = '') {
        if (!session || !platform) return
        const notifications = {...(session.taskState?.notifications || {})}
        notifications[platform] = {state, notificationId: String(notificationId || ''), lastError: String(lastError || ''), updatedAt: Date.now()}
        const nextState = session.taskState ? createTaskStatePatch({...session.taskState, notifications, updatedAt: Date.now()}) : taskStateFromCompletion({...session, taskState: {notifications}})
        updateTaskState(session, sessionId, nextState)
        broadcastTaskLifecycle(sessionId)
    }

    async function initializeTaskWorkbenchSession({session, sessionId, taskId, turnId, source, userId = null, goal, taskText = '', content = '', decision}) {
        const taskWorkbench = getTaskWorkbench()
        if (!taskWorkbench) throw Object.assign(new Error('Task Workbench Runtime 尚未初始化'), {code: 'TASK_WORKBENCH_UNAVAILABLE'})
        const phasePlan = resolveTaskPhases(decision)
        const projectContext = await buildProjectContext(session.workDir, {persist: true})
        const agentRoute = resolveTaskAgents(projectContext || {}, decision).map(item => item.id)
        const metadata = createTaskMetadata({taskText: taskText || goal, content: content || goal, source})
        const plan = createTaskPlan({taskId, turnId, sessionId, source, userId, goal, metadata, workDir: session.workDir, decision, executionMode: decision.executionMode, projectContext, phases: phasePlan.phases, reviewRequired: decision.finalReview !== 'none', acceptanceCriteria: ['完成用户明确要求', '执行与风险相称的验证', '记录未验证风险']})
        session.taskMetadata = metadata
        session.projectContext = projectContext
        session.taskPhasePlan = phasePlan
        session.agentRoute = agentRoute
        session.coordinatorTaskId = plan.taskId
        const accepted = taskWorkbench.acceptTask({plan, projectContext, agentRoute})
        session.taskPitfallReminders = accepted.pitfalls
        return accepted
    }

    function buildTaskPitfallReminder(reminders = []) {
        const items = reminders.slice(0, 5).map(item => {
            const prevention = String(item.prevention || item.summary || '').trim().slice(0, 500)
            return prevention ? `- ${String(item.title || '历史踩坑').slice(0, 160)}：${prevention}` : ''
        }).filter(Boolean)
        return items.length ? `\n\n[Bridge 相关 Pitfall 提醒]\n${items.join('\n')}\n请只在与当前任务相关时应用，并以当前代码和验证证据为准。` : ''
    }

    function requestCoordinatorCompletion(session, {notificationIntentPersisted = false} = {}) {
        const snapshot = session?.coordinatorTaskId ? getTaskCoordinator()?.getTaskSnapshot(session.coordinatorTaskId) : null
        if (!snapshot) return null
        return getTaskWorkbench()?.requestCompletion(snapshot.taskId, {notificationIntentPersisted}) || null
    }

    function getWaitingCoordinatorTask(session) {
        const snapshot = session?.coordinatorTaskId ? getTaskCoordinator()?.getTaskSnapshot(session.coordinatorTaskId) : null
        return snapshot?.status === 'waiting_user' ? snapshot : null
    }

    function resumeWaitingCoordinatorTask(session) {
        const snapshot = getWaitingCoordinatorTask(session)
        if (!snapshot) return null
        return getTaskCoordinator()?.resumePlannedTask({taskId: snapshot.taskId}) || null
    }

    function requiredTaskNotificationPlatforms(session) {
        const turnIdentity = session?.taskCompletionIdentity || session?.activeTurnIdentity || null
        return resolveRequiredNotificationPlatforms({identity: turnIdentity, mirrors: session?.mirrors || {}})
    }

    function taskStateWithNotificationIntents(session, state, notificationId) {
        const notifications = {...(state?.notifications || {})}
        for (const platform of requiredTaskNotificationPlatforms(session)) {
            if (notifications[platform]?.notificationId === notificationId) continue
            notifications[platform] = {state: 'pending', notificationId, lastError: '', updatedAt: Date.now()}
        }
        return createTaskStatePatch({...state, notifications})
    }

    function updateTaskCompletion(session, sessionId, event) {
        const transition = transitionTaskCompletion(session?.taskCompletion, event)
        if (!session) return transition
        session.taskCompletion = transition.state
        let nextState = taskStateFromCompletion(session)
        const terminalEffect = transition.effects.find(effect => ['complete', 'fail', 'pause'].includes(effect?.type))
        if (terminalEffect) {
            const eventType = terminalEffect.type === 'complete' ? 'task_completed' : terminalEffect.type === 'pause' ? 'task_review_paused' : 'task_failed'
            nextState = taskStateWithNotificationIntents(session, nextState, `${session.taskCompletionTaskId || sessionId}:${eventType}`)
        }
        updateTaskState(session, sessionId, nextState)
        return transition
    }

    function getTaskLifecycleSnapshot(sessionId, session = sessions.get(sessionId)) {
        if (!session) return null
        let workflows = []
        try { workflows = getSessionWorkflowStates(sessionId) } catch (error) { logger.debug({err: error, sessionId: sessionId?.slice(0, 8)}, '读取任务生命周期 Workflow 快照失败') }
        const coordinator = session.coordinatorTaskId ? getTaskCoordinator()?.getTaskSnapshot(session.coordinatorTaskId) : null
        return createTaskLifecycleSnapshot({sessionId, runtime: {...getSessionRuntimeState(session), taskWorkflowPending: hasPendingTaskWorkflow(session._taskWorkflowGate)}, task: getTaskStateForSessionClient()(session), workflows, coordinator})
    }

    function broadcastTaskLifecycle(sessionId) {
        const snapshot = getTaskLifecycleSnapshot(sessionId)
        if (snapshot) getBroadcastDesktop()(sessionId, {type: 'session_lifecycle_snapshot', ...snapshot})
    }

    return {updateTaskState, taskStateFromCompletion, updateTaskNotificationState, initializeTaskWorkbenchSession, buildTaskPitfallReminder, requestCoordinatorCompletion, getWaitingCoordinatorTask, resumeWaitingCoordinatorTask, requiredTaskNotificationPlatforms, taskStateWithNotificationIntents, updateTaskCompletion, getTaskLifecycleSnapshot, broadcastTaskLifecycle}
}
