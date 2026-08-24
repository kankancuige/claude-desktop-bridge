/**
 * Coordinator Verification Runtime。
 * 负责受信命令选择、验证 Campaign 执行、持久化与失败降级。
 */
export function createCoordinatorVerificationRuntime(deps = {}) {
    const {
        taskCoordinator, taskWorkbench, createVerificationAdapterRegistry,
        createCommandVerificationAdapter, createVerificationCampaignService,
        verificationRepository = null, projectKeyForWorkDir, appendSessionEvent, logger = {warn() {}},
    } = deps
    if (!taskCoordinator || !taskWorkbench || typeof createVerificationCampaignService !== 'function') {
        throw new TypeError('coordinator verification dependencies are required')
    }

function trustedValidationCommands(projectContext) {
    const commands = Array.isArray(projectContext?.commands) ? projectContext.commands : []
    const tests = commands.filter(item => item?.kind === 'test' || /^test(?::|$)/i.test(String(item?.name || '')))
    const builds = commands.filter(item => item?.kind === 'build' || /^build(?::|$)/i.test(String(item?.name || '')))
    const unique = new Map()
    for (const item of [...tests, ...builds]) {
        const normalized = {...item, kind: tests.includes(item) ? 'test' : 'build'}
        const key = `${normalized.executable}\0${(normalized.args || []).join('\0')}`
        if (!unique.has(key)) unique.set(key, normalized)
    }
    return [...unique.values()].slice(0, 20)
}

async function runCoordinatorValidation(sessionId, session, {reason = 'primary_result'} = {}) {
    const snapshot = session?.coordinatorTaskId ? taskCoordinator?.getTaskSnapshot(session.coordinatorTaskId) : null
    if (!snapshot || !snapshot.plan.steps.some(step => step.phase === 'validate' && step.required !== false)) return snapshot
    if (snapshot.verification?.status === 'passed') return snapshot
    if (['blocked_environment', 'regression_detected', 'inconclusive'].includes(snapshot.verification?.status)) return snapshot
    if (session._coordinatorValidationPromise) return session._coordinatorValidationPromise
    const commands = trustedValidationCommands(session.projectContext)
    if (!commands.length) {
        return taskWorkbench.recordVerification(snapshot.taskId, {
            status: 'inconclusive', evidenceLevel: 'L0', testsExecuted: false,
            summary: '目标项目未识别到受信测试或构建命令，无法自动验证',
        })
    }
    session._coordinatorValidationPromise = (async () => {
        const registry = createVerificationAdapterRegistry([
            createCommandVerificationAdapter({commands}),
        ])
        const projectKey = session.projectContext?.projectKey || projectKeyForWorkDir(session.workDir)
        const campaignService = createVerificationCampaignService({
            registry,
            persist: campaign => {
                const repository = typeof verificationRepository === 'function' ? verificationRepository() : verificationRepository
                if (!repository?.upsertVerificationCampaign) return false
                try {
                    return repository.upsertVerificationCampaign({projectKey, campaign, updatedAt: campaign.updatedAt || Date.now()})
                } catch (error) {
                    logger.warn({err: error, taskId: snapshot.taskId}, 'Verification Campaign 持久化失败')
                    return false
                }
            },
            publish: event => appendSessionEvent(session, event.type, {
                taskId: snapshot.taskId,
                campaignId: event.campaignId,
                mode: event.mode || null,
                status: event.status || null,
                evidenceLevel: event.evidenceLevel || null,
            }, {critical: event.type === 'verification/completed'}),
        })
        const campaign = campaignService.create({
            taskId: snapshot.taskId,
            adapterId: 'project-command',
            scenarios: commands.map((command, index) => ({
                id: `${command.kind || 'command'}:${command.name || index + 1}`,
                kind: command.kind || 'command', command, workDir: session.workDir,
            })),
            rounds: 1,
            evidenceLevel: commands.some(command => command.kind === 'test') ? 'L2' : 'L1',
        })
        const result = await campaignService.runVerificationCampaign(campaign.campaignId)
        const current = taskCoordinator.getTaskSnapshot(snapshot.taskId)
        if (!current) return null
        const tests = result.candidate.filter(item => item.kind === 'test').map(item => ({
            name: item.scenarioId,
            status: item.passed ? 'passed' : 'failed',
            executed: true,
            evidence: `exitCode=${item.exitCode ?? 'unknown'}; round=${item.round}`,
        }))
        const hasTests = tests.length > 0
        const status = result.status === 'passed' && !hasTests ? 'inconclusive' : result.status
        const summary = status === 'passed'
            ? `${commands.length} 个受信验证命令全部通过，其中测试 ${tests.length} 个`
            : result.status === 'passed'
                ? `${commands.length} 个受信构建命令通过，但项目未识别到测试命令`
                : `${commands.length} 个受信验证命令执行状态：${result.status}`
        return taskWorkbench.recordVerification(current.taskId, {
            status,
            evidenceLevel: result.evidenceLevel,
            testsExecuted: hasTests,
            campaignId: result.campaignId,
            results: result.candidate,
            tests,
            summary,
        })
    })().catch(error => {
        const current = taskCoordinator.getTaskSnapshot(snapshot.taskId)
        if (!current) return null
        logger.warn({err: error, sessionId: sessionId?.slice(0, 8), reason}, 'Coordinator 自动验证异常，降级为验证不足')
        return taskWorkbench.recordVerification(current.taskId, {
            status: 'inconclusive', evidenceLevel: 'L0', testsExecuted: false,
            summary: `自动验证异常：${String(error?.message || error).slice(0, 500)}`,
        })
    }).finally(() => {
        session._coordinatorValidationPromise = null
    })
    return session._coordinatorValidationPromise
}


    return {trustedValidationCommands, runCoordinatorValidation}
}
