/**
 * 任务完成事件运行时。
 *
 * 只负责把完成状态投影为客户端生命周期事件，并持久化通知意图；
 * 验证、审查和修复策略由上层 Completion Coordinator 负责。
 */
export function createTaskCompletionEventRuntime({
    taskStateForInconclusive,
    taskStateFromCompletion,
    taskStateWithNotificationIntents,
    taskStateForSessionClient,
    updateTaskState,
    broadcastTurn,
    broadcastTaskLifecycle,
    maybeMirror,
    logger = {warn() {}},
    now = () => Date.now(),
} = {}) {
    if (typeof updateTaskState !== 'function' || typeof broadcastTurn !== 'function') {
        throw new TypeError('task completion event dependencies are required')
    }

    function taskCompletionEventForClient(session, sessionId, type, extra = {}) {
        const identity = session?.taskCompletionIdentity || null
        const sequence = (session._taskCompletionSequence = (session._taskCompletionSequence || 0) + 1)
        const taskId = session?.taskCompletionTaskId || `${sessionId}:${session?.taskCompletionTurnId || 'task'}`
        const turnId = session?.taskCompletionTurnId || session?.activeTurnId || null
        const terminal = ['task_completed', 'task_failed', 'task_review_paused', 'task_verification_inconclusive'].includes(type)
        if (session && terminal && !session.taskCompletedAt) session.taskCompletedAt = now()
        let nextState = type === 'task_verification_inconclusive'
            ? taskStateForInconclusive(session?.taskState, {
                detail: extra.detail || '验证不足，任务尚未完成',
                completedAt: session.taskCompletedAt || now(),
            })
            : taskStateFromCompletion(session)
        if (terminal) nextState = taskStateWithNotificationIntents(session, nextState, `${taskId}:${type}`)
        updateTaskState(session, sessionId, nextState)
        const taskState = taskStateForSessionClient(session)
        broadcastTurn(sessionId, {
            type,
            taskId,
            turnId,
            required: Boolean(session?.taskCompletion?.reviewPlan?.required),
            status: taskState.status,
            outcome: taskState.outcome,
            sequence,
            timestamp: now(),
            startedAt: taskState.startedAt,
            durationMs: taskState.durationMs,
            notificationId: `${taskId}:${type}`,
            taskState,
            ...extra,
        }, identity)
        broadcastTaskLifecycle?.(sessionId)
    }

    async function publishVerificationInconclusive(sessionId, session, detail, coordinator = null) {
        taskCompletionEventForClient(session, sessionId, 'task_verification_inconclusive', {detail, coordinator})
        try {
            await maybeMirror?.(
                sessionId,
                {outcome: 'incomplete', continuationReason: 'execution_error'},
                `${session.taskCompletionTaskId || sessionId}:task_verification_inconclusive`,
            )
        } catch (error) {
            logger.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '验证不足镜像失败')
        }
    }

    return {taskCompletionEventForClient, publishVerificationInconclusive}
}
