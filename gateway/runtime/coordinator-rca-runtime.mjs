/** Coordinator 根因分析 Workflow 适配。 */
export function createCoordinatorRcaRuntime({
    taskWorkbench,
    getTaskWorkbench = () => taskWorkbench,
    taskCoordinator,
    listWorkflows,
    presetRunState,
    runWorkflow,
    loadWorkflowConfig,
    logger = {error() {}},
} = {}) {
    if (!taskCoordinator || typeof getTaskWorkbench !== 'function' || typeof listWorkflows !== 'function' || typeof runWorkflow !== 'function') {
        throw new TypeError('coordinator RCA dependencies are required')
    }
    async function runCoordinatorRootCauseAnalysis(sessionId, session, repairDecision, outcome) {
        const taskWorkbench = getTaskWorkbench()
        const taskId = session?.coordinatorTaskId
        if (!taskId) return {action: 'stop', status: 'diagnosis_required', result: null}
        const workflow = 'root-cause-analysis'
        if (!listWorkflows().some(item => item.enabled !== false && item.name.replace(/\.mjs$/, '') === workflow)) {
            return taskWorkbench.recordRcaResult(taskId, {summary: 'Root Cause Workflow 不可用'})
        }
        const snapshot = taskCoordinator.getTaskSnapshot(taskId)
        const step = snapshot?.plan?.steps?.find(item => item.status === 'running') || snapshot?.plan?.steps?.find(item => item.phase === 'review')
        const runKey = `${workflow}:${sessionId}:${snapshot?.revision || 0}`
        let workflowId
        try {
            workflowId = presetRunState(workflow, runKey, sessionId)
            const result = await runWorkflow(workflow, sessionId, {
                target: session.workDir,
                evidence: {
                    fingerprint: repairDecision?.fingerprint || '', reason: repairDecision?.repair?.reason || '',
                    previousStrategy: session._lastRepairStrategy || 'apply-review-findings',
                    findings: (outcome?.blockingFindings || []).slice(0, 12),
                    changedFiles: (session.taskReviewFiles || []).map(item => item.path).filter(Boolean).slice(0, 80),
                },
                _workflowTier: 'power', _forceModelTier: 'power', _modelTiers: loadWorkflowConfig().modelTiers || {},
                _fixedModel: session.modelMode === 'fixed' ? session.queryOpts?.model || null : null,
                _permissionMode: 'plan', _taskId: taskId, _stepId: step?.stepId || `${taskId}:rca`,
                _taskDecision: session.taskDecision || null, _projectContext: session.projectContext || null,
                _returnToParent: false, _taskOwned: false, _runKey: runKey,
            })
            return taskWorkbench.recordRcaResult(taskId, result || {})
        } catch (error) {
            logger.error({err: error, sessionId: sessionId?.slice(0, 8), workflowId}, 'Root Cause Agent 执行失败')
            return taskWorkbench.recordRcaResult(taskId, {summary: `RCA 执行失败：${String(error?.message || error).slice(0, 500)}`})
        }
    }
    return {runCoordinatorRootCauseAnalysis}
}
