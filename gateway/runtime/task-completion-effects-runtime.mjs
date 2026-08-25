/**
 * 任务完成副作用运行时。
 * 将验证、审查、修复、完成及失败通知编排在显式端口之上。
 */
export function createTaskCompletionEffectsRuntime(deps = {}) {
    const {
        sessions, runCoordinatorValidation, taskWorkbench, getTaskWorkbench, taskCompletionEventForClient,
        publishVerificationInconclusive, autoTriggerFinalReview, runCoordinatorRootCauseAnalysis,
        updateTaskCompletion, beginTurn, markInternalInput, hasPersistedNotificationIntents,
        requiredTaskNotificationPlatforms, requestCoordinatorCompletion, updateTaskState,
        taskStateFromCompletion, maybeMirror, taskCoordinator, broadcastTaskLifecycle, log,
    } = deps
    if (!sessions || typeof updateTaskCompletion !== 'function') {
        throw new TypeError('task completion effects dependencies are required')
    }

async function applyTaskCompletionEffectsUnsafe(sessionId, effects = []) {
    const s = sessions.get(sessionId)
    if (!s) return
    const currentTaskWorkbench = () => typeof getTaskWorkbench === 'function' ? getTaskWorkbench() : taskWorkbench
    for (const effect of effects) {
        if (effect.type === 'start_review') {
            // 验证是完成门禁的一部分。先等待受信项目命令的真实结果，再启动最终审查，
            // 避免 SDK 主回答成功时把未验证修改送入“已完成”出口。
            const validation = await runCoordinatorValidation(sessionId, s, {reason: 'before_review'})
            if (['blocked', 'inconclusive', 'regression_detected'].includes(validation?.status)) {
                const detail = validation.blockers?.at(-1)?.detail || validation.verification?.summary || '验证不足，任务尚未完成'
                currentTaskWorkbench()?.finalizeReport(s.coordinatorTaskId, {
                    unresolvedRisks: [detail],
                })
                await publishVerificationInconclusive(sessionId, s, detail, {
                    status: validation.status,
                    verification: validation.verification,
                })
                continue
            }
            const plan = effect.plan || s.taskCompletion?.reviewPlan
            taskCompletionEventForClient(s, sessionId, 'task_reviewing', {
                reviewTier: plan?.tier || 'balanced',
                reviewMode: plan?.mode || 'focused',
                reviewRound: effect.round || s.taskCompletion?.reviewRound || 1,
                riskDomains: plan?.riskDomains || ['correctness'],
            })
            const checkpoint = {
                id: s.taskReviewCheckpointId || `task-${sessionId}`,
                prompt: s.taskCompletionDecision?.text || s.lastTaskResult?.result || '',
                files: s.taskReviewFiles || [],
            }
            await autoTriggerFinalReview(sessionId, s.taskCompletionDecision, checkpoint, plan)
        } else if (effect.type === 'request_fix') {
            taskCompletionEventForClient(s, sessionId, 'task_changes_required', {
                review: s.taskCompletion?.reviewOutcome || null,
                detail: effect.outcome?.summary || '审查发现需要修复的问题',
            })
            if (!s.pushStream || ![1, 2].includes(s.taskCompletion?.fixAttempts)) continue
            if (s._repairDecision?.repair?.action === 'rca') {
                s._repairDecision = await runCoordinatorRootCauseAnalysis(sessionId, s, s._repairDecision, effect.outcome)
            }
            const repairAction = s._repairDecision?.repair?.action || s._repairDecision?.action
            if (repairAction && repairAction !== 'retry') {
                const detail = `自动修复已停止：${s._repairDecision?.repair?.status || s._repairDecision?.status || s._repairDecision?.repair?.reason || 'diagnosis_required'}`
                currentTaskWorkbench()?.finalizeReport(s.coordinatorTaskId, {unresolvedRisks: [detail]})
                await publishVerificationInconclusive(sessionId, s, detail)
                continue
            }
            updateTaskCompletion(s, sessionId, {type: 'fix_started'})
            taskCompletionEventForClient(s, sessionId, 'task_fixing', {
                review: s.taskCompletion?.reviewOutcome || null,
                detail: effect.outcome?.summary || '正在根据最终审查修复阻断问题',
            })
            const findings = (effect.outcome?.blockingFindings || []).slice(0, 12).map(item => {
                const location = item.file ? `${item.file}${item.line ? ':' + item.line : ''}` : ''
                return `- [${item.severity || 'high'}] ${item.title || '问题'}${location ? ` (${location})` : ''}\n  ${item.description || ''}${item.suggestion ? `\n  建议：${item.suggestion}` : ''}`
            }).join('\n')
            const prompt = [
                '[Bridge 内部审查反馈] 主任务已执行完成，但最终审查发现以下必须修复的问题。',
                '请只修复这些问题，保留已完成的其他改动；完成后运行必要的测试。',
                s._repairDecision?.result?.nextStrategy ? `RCA 新策略：${s._repairDecision.result.nextStrategy}` : '',
                findings || '- 审查返回了未结构化的阻断问题，请检查本轮变更并修复真实问题。',
            ].filter(Boolean).join('\n')
            beginTurn(sessionId, prompt)
            markInternalInput(s, s.taskCompletionDecision)
            s.pushStream.push({
                type: 'user',
                session_id: sessionId,
                message: {role: 'user', content: [{type: 'text', text: prompt}]},
                parent_tool_use_id: null,
            })
            s.hasUserTurns = true
            await new Promise(resolve => setImmediate(resolve))
        } else if (effect.type === 'complete') {
            if (s.taskCompletion?.notificationEmitted) continue
            const validation = await runCoordinatorValidation(sessionId, s, {reason: 'before_complete'})
            const notificationId = `${s.taskCompletionTaskId || sessionId}:task_completed`
            const notificationIntentPersisted = hasPersistedNotificationIntents({
                notifications: s.taskState?.notifications,
                platforms: requiredTaskNotificationPlatforms(s),
                notificationId,
            })
            const completed = requestCoordinatorCompletion(s, {notificationIntentPersisted})
            if (completed?.status !== 'completed') {
                const detail = completed?.blockers?.at(-1)?.detail
                    || validation?.verification?.summary
                    || '完成门禁未满足，任务状态已保留为待处理'
                await publishVerificationInconclusive(sessionId, s, detail,
                    completed ? {status: completed.status, verification: completed.verification} : null)
                continue
            }
            updateTaskState(s, sessionId, taskStateFromCompletion(s, effect.detail))
            taskCompletionEventForClient(s, sessionId, 'task_completed', {
                reply: s.taskFinalReplyText || s.taskState?.finalReplyText || '',
                review: s.taskCompletion?.reviewOutcome || null,
            })
            try {
                const notification = await maybeMirror(sessionId, {outcome: 'succeeded'}, notificationId)
                if (notification.failed === 0 && notification.pending === 0) {
                    updateTaskCompletion(s, sessionId, {type: 'notification_sent'})
                }
            } catch (error) {
                log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '最终完成镜像失败')
            }
        } else if (effect.type === 'fail' || effect.type === 'pause') {
            const workbench = currentTaskWorkbench()
            if (s.coordinatorTaskId && workbench) {
                const snapshot = taskCoordinator.getTaskSnapshot(s.coordinatorTaskId)
                const step = snapshot?.plan?.steps?.find(item => item.status === 'running')
                workbench.recordTaskEvent(s.coordinatorTaskId, effect.type === 'pause'
                    ? {type: 'task/paused', detail: effect.detail || '任务已暂停'}
                    : step
                        ? {type: 'phase/failed', phase: step.phase, stepId: step.stepId, code: 'task_execution_failed', detail: effect.detail || '任务未完成'}
                        : {type: 'task/status', status: 'failed'})
                workbench.finalizeReport(s.coordinatorTaskId, {unresolvedRisks: [effect.detail || '任务未完成']})
            }
            updateTaskState(s, sessionId, taskStateFromCompletion(s, effect.detail))
            taskCompletionEventForClient(s, sessionId, effect.type === 'pause' ? 'task_review_paused' : 'task_failed', {
                detail: effect.detail || '任务未完成',
                review: s.taskCompletion?.reviewOutcome || null,
            })
            try {
                const eventType = effect.type === 'pause' ? 'task_review_paused' : 'task_failed'
                await maybeMirror(sessionId, {outcome: effect.type === 'pause' ? 'incomplete' : 'failed', continuationReason: 'execution_error'}, `${s.taskCompletionTaskId || sessionId}:${eventType}`)
            } catch (error) {
                log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '任务失败镜像失败')
            }
        }
    }
}

async function applyTaskCompletionEffects(sessionId, effects = []) {
    try {
        await applyTaskCompletionEffectsUnsafe(sessionId, effects)
    } catch (error) {
        const s = sessions.get(sessionId)
        if (!s) throw error
        const detail = `任务完成收口异常：${String(error?.message || error || '未知错误')}`.slice(0, 2000)
        log?.error?.({err: error, sessionId: sessionId?.slice(0, 8)}, detail)
        try { updateTaskCompletion(s, sessionId, {type: 'runtime_failed', detail}) }
        catch (transitionError) { log?.error?.({err: transitionError, sessionId: sessionId?.slice(0, 8)}, '完成异常状态转换失败') }
        try { updateTaskState?.(s, sessionId, taskStateFromCompletion?.(s, detail)) }
        catch (stateError) { log?.error?.({err: stateError, sessionId: sessionId?.slice(0, 8)}, '完成异常任务状态持久化失败') }
        try {
            taskCompletionEventForClient?.(s, sessionId, 'task_failed', {detail})
            broadcastTaskLifecycle?.(sessionId)
        } catch (broadcastError) {
            log?.warn?.({err: broadcastError, sessionId: sessionId?.slice(0, 8)}, '完成异常终态广播失败')
        }
        try {
            await maybeMirror?.(sessionId, {outcome: 'failed', continuationReason: 'completion_effect_error'}, `${s.taskCompletionTaskId || sessionId}:task_failed`)
        } catch (mirrorError) {
            log?.warn?.({err: mirrorError, sessionId: sessionId?.slice(0, 8)}, '完成异常失败镜像失败')
        }
    }
}
/**
 * 空白会话只在第一条消息判断一次跨会话接力。内部上下文送入 SDK，
 * checkpoint、IM echo 和前端气泡仍保留用户原文。
 */

    return {applyTaskCompletionEffects}
}
