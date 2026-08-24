/**
 * Final Review Runtime。
 * 独立负责最终审查 Workflow 的预注册、执行、结果归一化和父任务收口。
 */
export function createFinalReviewRuntime(deps = {}) {
    const {
        sessions, loadWfConfig, updateTaskCompletion, applyTaskCompletionEffects,
        resolveFinalReviewPlan, listWorkflows, presetRunState, broadcastTaskLifecycle,
        broadcast, runWfScript, normalizeReviewOutcome, taskCoordinator, taskWorkbench,
        logger = {warn() {}, error() {}},
    } = deps
    if (!sessions || typeof updateTaskCompletion !== 'function' || typeof runWfScript !== 'function') {
        throw new TypeError('final review dependencies are required')
    }

async function autoTriggerFinalReview(sessionId, taskDecision, checkpoint, reviewPlan = null) {
    const s = sessions.get(sessionId)
    const wfCfg = loadWfConfig()
    if (!s) return
    if (!wfCfg.enabled || !checkpoint?.files?.length) {
        const detail = !wfCfg.enabled ? '最终审查在启动前被关闭' : '最终审查缺少变更文件'
        const transition = updateTaskCompletion(s, sessionId, {type: 'review_error', detail})
        await applyTaskCompletionEffects(sessionId, transition.effects)
        return
    }
    const plan = reviewPlan || resolveFinalReviewPlan({decision: taskDecision, checkpoint})
    if (!plan.required) return
    const reviewKey = `${checkpoint.id || 'checkpoint'}:${s.taskCompletion?.reviewRound || 1}`
    if (s._finalReviewKey === reviewKey) return
    const workflow = 'final-review'
    if (!listWorkflows().some(w => w.enabled !== false && w.name.replace('.mjs', '') === workflow)) {
        const transition = updateTaskCompletion(s, sessionId, {type: 'review_error', detail: '最终审查 Workflow 不存在'})
        await applyTaskCompletionEffects(sessionId, transition.effects)
        return
    }
    let wfId
    const runKey = `${workflow}:${sessionId}`
    try {
        wfId = presetRunState(workflow, runKey, sessionId)
        broadcastTaskLifecycle(sessionId)
    } catch (error) {
        const detail = error?.code === 'WORKFLOW_ALREADY_RUNNING' ? '已有最终审查正在运行' : String(error?.message || error)
        if (error?.code !== 'WORKFLOW_ALREADY_RUNNING') logger.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '最终复核预注册失败')
        const transition = updateTaskCompletion(s, sessionId, {type: 'review_error', detail})
        await applyTaskCompletionEffects(sessionId, transition.effects)
        return
    }
    s._finalReviewKey = reviewKey
    broadcast(sessionId, {type: 'workflow_auto_started', workflowId: wfId, name: workflow, task: '回合完成后的风险门禁最终审查', finalReview: true, reviewTier: plan.tier, required: true, ts: Date.now()})
    try {
        const result = await runWfScript(workflow, sessionId, {
            target: s.workDir,
            task: checkpoint.prompt,
            files: checkpoint.files.map(file => ({
                path: file.path,
                lines: Math.max(1, Number(file.added || 0) + Number(file.removed || 0)),
            })),
            reviewTier: plan.tier,
            reviewMode: plan.mode,
            riskDomains: plan.riskDomains,
            _workflowTier: plan.tier,
            _forceModelTier: plan.tier,
            _modelTiers: wfCfg.modelTiers || {},
            _fixedModel: s.modelMode === 'fixed' ? s.queryOpts?.model || null : null,
            _permissionMode: 'plan',
            _taskId: s.coordinatorTaskId || s.taskCompletionTaskId,
            _stepId: taskCoordinator.getTaskSnapshot(s.coordinatorTaskId)?.plan?.steps?.find(step => step.phase === 'review')?.stepId || null,
            _taskDecision: s.taskDecision || null,
            _projectContext: s.projectContext || null,
            _returnToParent: false,
            _runKey: runKey,
        })
        if (result?.paused) {
            const transition = updateTaskCompletion(s, sessionId, {type: 'review_paused', detail: '最终审查已暂停，可恢复后继续'})
            await applyTaskCompletionEffects(sessionId, transition.effects)
            return
        }
        const outcome = normalizeReviewOutcome(result, plan, {files: checkpoint.files})
        if (s.coordinatorTaskId && taskWorkbench) {
            taskWorkbench.recordReviewResult(s.coordinatorTaskId, {
                passed: outcome.passed,
                summary: outcome.summary,
                findings: [...outcome.blockingFindings, ...outcome.advisoryFindings],
            })
            s._repairDecision = outcome.passed ? null : taskWorkbench.recordFailure(s.coordinatorTaskId, {
                module: 'final-review', phase: 'review', errorCode: 'REVIEW_BLOCKING_FINDINGS',
                message: outcome.blockingFindings.map(item => `${item.file}:${item.line || ''}:${item.title}`).join('|') || outcome.summary,
                strategy: 'apply-review-findings',
                targetFiles: checkpoint.files.map(file => file.path),
            })
        }
        const transition = updateTaskCompletion(s, sessionId, {type: 'review_result', outcome})
        await applyTaskCompletionEffects(sessionId, transition.effects)
    } catch (error) {
        logger.error({err: error, sessionId: sessionId?.slice(0, 8), workflow}, '最终复核失败')
        const transition = updateTaskCompletion(s, sessionId, {type: 'review_error', detail: String(error?.message || error)})
        await applyTaskCompletionEffects(sessionId, transition.effects)
    }
}


    return {autoTriggerFinalReview}
}
