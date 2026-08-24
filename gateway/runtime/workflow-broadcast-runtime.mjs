/** Workflow/Agent 生命周期事件广播。 */
export function createWorkflowBroadcastRuntime({
    sessions,
    getRunState,
    getTaskCoordinator = () => null,
    getTaskWorkbench = () => null,
    createTaskWorkflowGate,
    attachTaskWorkflow,
    noteTaskWorkflowTerminal,
    takeDeferredPrimaryResult,
    updateTaskCompletion,
    applyTaskCompletionEffects,
    appendSessionEvent,
    reportImProgressEvent,
    broadcast,
    broadcastTaskLifecycle,
    logger = {error() {}}
} = {}) {
    if (!sessions || typeof getRunState !== 'function' || typeof broadcast !== 'function'
        || typeof broadcastTaskLifecycle !== 'function') throw new TypeError('workflow broadcast dependencies are required')

    function broadcastWorkflowEvent(sessionId, message) {
        const session = sessions.get(sessionId)
        const workflowState = message?.workflowId ? getRunState(message.workflowId) : null
        let settlingDeferredPrimary = false
        const coordinatorTaskId = session?.coordinatorTaskId
        const coordinator = getTaskCoordinator()
        const snapshot = coordinatorTaskId ? coordinator?.getTaskSnapshot(coordinatorTaskId) : null
        const step = snapshot?.plan?.steps?.find(item => item.status === 'running')
            || snapshot?.plan?.steps?.find(item => item.phase === snapshot.phase) || null
        if (coordinatorTaskId && message?.workflowId) {
            const workbench = getTaskWorkbench()
            if (message.type === 'workflow_started') workbench?.recordTaskEvent(coordinatorTaskId, {type: 'workflow/started', workflowId: message.workflowId})
            else if (message.type === 'workflow_done') workbench?.recordTaskEvent(coordinatorTaskId, {type: 'workflow/completed', workflowId: message.workflowId})
            else if (['workflow_paused', 'workflow_error'].includes(message.type)) workbench?.recordTaskEvent(coordinatorTaskId, {type: 'workflow/failed', workflowId: message.workflowId})
            else if (message.type === 'workflow_agent_started') workbench?.recordAgentEvent(coordinatorTaskId, {
                type: 'agent/started', agentRunId: `${message.workflowId}:${message.id || 'agent'}`,
                stepId: step?.stepId || null, role: message.role || message.agentType || 'developer',
            })
            else if (message.type === 'workflow_agent_done' || message.type === 'workflow_agent_error') workbench?.recordAgentEvent(coordinatorTaskId, {
                type: message.type === 'workflow_agent_done' ? 'agent/completed' : 'agent/failed',
                agentRunId: `${message.workflowId}:${message.id || 'agent'}`,
                stepId: step?.stepId || null, role: message.role || message.agentType || 'developer',
                result: message.agentResult || null,
            })
        }
        if (message?.type === 'workflow_started' && workflowState?._args?._taskOwned === true && session) {
            if (!session._taskWorkflowGate) session._taskWorkflowGate = createTaskWorkflowGate()
            attachTaskWorkflow(session._taskWorkflowGate, message.workflowId)
        } else if (['workflow_done', 'workflow_paused', 'workflow_error'].includes(message?.type) && session) {
            const taskOwned = session._taskWorkflowGate?.active?.has(String(message.workflowId || ''))
            if (taskOwned) {
                noteTaskWorkflowTerminal(session._taskWorkflowGate, message.workflowId, {
                    returnsToParent: message.type === 'workflow_done' && workflowState?._args?._returnToParent !== false,
                })
                const deferred = takeDeferredPrimaryResult(session._taskWorkflowGate)
                if (deferred) {
                    const transition = updateTaskCompletion(session, sessionId, deferred)
                    settlingDeferredPrimary = transition.effects.length > 0
                    void applyTaskCompletionEffects(sessionId, transition.effects).catch(error => logger.error({err: error, sessionId: sessionId?.slice(0, 8)}, '任务 Workflow 结束后结算父任务失败'))
                }
            }
        }
        if (session && typeof message?.type === 'string') appendSessionEvent(session, 'workflow/event', {
            eventType: message.type.slice(0, 120),
            workflowId: typeof message.workflowId === 'string' ? message.workflowId.slice(0, 160) : null,
            agentId: typeof message.id === 'string' ? message.id.slice(0, 160) : null,
            agentType: typeof message.agentType === 'string' ? message.agentType.slice(0, 120) : null,
        })
        reportImProgressEvent?.(sessionId, message, session?.taskCompletionIdentity || null)
        broadcast(sessionId, message)
        if (!settlingDeferredPrimary && ['workflow_started', 'workflow_resumed', 'workflow_done', 'workflow_paused', 'workflow_error'].includes(message?.type)) broadcastTaskLifecycle(sessionId)
    }
    return {broadcastWorkflowEvent}
}
