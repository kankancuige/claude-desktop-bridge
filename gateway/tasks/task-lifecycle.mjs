const ACTIVE_TASK_PHASES = new Set(['running', 'reviewing', 'changes_required', 'fixing'])
const ACTIVE_WORKFLOW_STATUSES = new Set(['starting', 'running'])
const TERMINAL_TASK_PHASES = new Set(['succeeded', 'incomplete', 'failed', 'review_paused', 'stopped', 'interrupted'])

function number(value) {
    return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0
}

function workflowPriority(workflow = {}) {
    if (workflow.status === 'running') return 4
    if (workflow.status === 'starting') return 3
    if (workflow.status === 'paused') return 2
    return 1
}

export function sortSessionWorkflows(workflows = []) {
    return [...workflows].sort((left, right) => {
        const priority = workflowPriority(right) - workflowPriority(left)
        if (priority !== 0) return priority
        return number(right.startedAt) - number(left.startedAt)
    })
}

export function getCurrentSessionWorkflow(workflows = []) {
    return sortSessionWorkflows(workflows)[0] || null
}

export function createTaskLifecycleSnapshot({sessionId = '', runtime = {}, task = {}, workflows = []} = {}) {
    const orderedWorkflows = sortSessionWorkflows(workflows)
    const taskStatus = String(task?.status || 'idle')
    const runtimeGenerating = runtime?.generating === true
    const taskWorkflowPending = runtime?.taskWorkflowPending === true
    // SDK result/cleanup 可能在父任务已完成后仍短暂保留 generating=true。
    // 该残留不是可停止的用户工作；真正的 Workflow pending 仍必须保持 busy。
    const taskHasTerminalOutcome = ['succeeded', 'incomplete', 'failed'].includes(String(task?.outcome || ''))
        && number(task?.completedAt) > 0
    const taskTerminal = TERMINAL_TASK_PHASES.has(taskStatus) || taskHasTerminalOutcome
    const runtimeActive = (runtimeGenerating && !taskTerminal) || taskWorkflowPending
    const taskActive = ACTIVE_TASK_PHASES.has(taskStatus)
    const workflowActive = orderedWorkflows.some(workflow => ACTIVE_WORKFLOW_STATUSES.has(String(workflow?.status || '')))
    const active = runtimeActive || taskActive || workflowActive
    const resumable = task?.resumable === true && TERMINAL_TASK_PHASES.has(taskStatus)

    return {
        version: 1,
        sessionId: String(sessionId || ''),
        sequence: number(task?.sequence),
        active,
        task: task || {},
        runtime: {
            ready: runtime?.runtimeReady === true || runtime?.running === true,
            generating: runtimeGenerating,
            taskWorkflowPending,
            pendingInputs: number(runtime?.pendingInputs),
        },
        workflows: orderedWorkflows,
        currentWorkflow: orderedWorkflows[0] || null,
        capabilities: {
            canSend: !active,
            canStop: active,
            canContinue: !active && resumable,
        },
    }
}
