export function createTaskWorkflowGate() {
    return {
        active: new Set(),
        pendingResultWorkflowIds: new Set(),
        resultTurnWorkflowIds: new Set(),
        primaryResult: null,
    }
}

export function attachTaskWorkflow(gate, workflowId) {
    if (!gate || !workflowId) return gate
    gate.active.add(String(workflowId))
    return gate
}

export function noteTaskWorkflowTerminal(gate, workflowId, {returnsToParent = true} = {}) {
    if (!gate || !workflowId || !gate.active.delete(String(workflowId))) return false
    if (returnsToParent) gate.pendingResultWorkflowIds.add(String(workflowId))
    return true
}

export function consumeTaskWorkflowResultTurn(gate, workflowId) {
    if (!gate || !workflowId) return false
    const normalizedId = String(workflowId)
    if (!gate.pendingResultWorkflowIds.delete(normalizedId)) return false
    gate.resultTurnWorkflowIds.add(normalizedId)
    return true
}

export function finishTaskWorkflowResultTurn(gate, workflowId) {
    if (!gate || !workflowId || !gate.resultTurnWorkflowIds.delete(String(workflowId))) {
        return {consumed: false, deferredPrimaryResult: null}
    }
    return {
        consumed: true,
        deferredPrimaryResult: takeDeferredPrimaryResult(gate),
    }
}

export function hasPendingTaskWorkflow(gate) {
    return Boolean(gate && (
        gate.active.size > 0
        || gate.pendingResultWorkflowIds.size > 0
        || gate.resultTurnWorkflowIds.size > 0
    ))
}

export function deferPrimaryResultForTaskWorkflow(gate, payload) {
    if (!hasPendingTaskWorkflow(gate)) return false
    gate.primaryResult = payload
    return true
}

export function takeDeferredPrimaryResult(gate) {
    if (!gate || hasPendingTaskWorkflow(gate) || !gate.primaryResult) return null
    const payload = gate.primaryResult
    gate.primaryResult = null
    return payload
}

export function clearTaskWorkflowGate(gate) {
    if (!gate) return false
    gate.active.clear()
    gate.pendingResultWorkflowIds.clear()
    gate.resultTurnWorkflowIds.clear()
    gate.primaryResult = null
    return true
}

export function taskWorkflowResultMarker(workflowId) {
    return `[Bridge Workflow Result:${String(workflowId || '')}]`
}

export function taskWorkflowResultIdFromMessage(message = {}) {
    const content = Array.isArray(message?.content) ? message.content : []
    const text = content
        .filter(block => block?.type === 'text')
        .map(block => String(block.text || ''))
        .join('\n')
    const match = text.match(/^\[Bridge Workflow Result:([^\]\r\n]{1,200})\]/)
    return match ? match[1] : null
}

export function isInternalWorkflowResultText(value) {
    return /^\[Bridge Workflow Result:[^\]\r\n]{1,200}\]/.test(String(value || ''))
}
