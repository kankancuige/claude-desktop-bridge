/** 定时任务运行时：cron 注册、并发限制、无人值守 Session 和超时清理。 */
export function createScheduledRuntime(deps = {}) {
    const {
        cron, scheduledTaskStore, sessions, cronJobs, scheduledRuns, MAX_SCHEDULED_CONCURRENT,
        MAX_SCHEDULED_DURATION_MS, log, isDirectoryPath, decideTask, MODEL, crypto, PushStream,
        loadCliSettings, makeQueryOptions, openSessionEventJournal, startClaudeAgent,
        createSessionRuntime, createTaskCompletionState, appendSessionEvent,
        initializeTaskWorkbenchSession, updateTaskState, taskStateFromCompletion,
        markInternalInput, buildTaskPitfallReminder, startStreamPump,
    } = deps
    if (!cron || !scheduledTaskStore || !sessions || !cronJobs || !scheduledRuns) throw new TypeError('scheduled runtime dependencies are required')

    function finishScheduledRun(id) {
        const run = scheduledRuns.get(id)
        if (!run) return
        if (run.timer) clearTimeout(run.timer)
        scheduledRuns.delete(id)
    }
    function destroyScheduledJob(id) {
    const job = cronJobs.get(id)
    if (!job) return
    cronJobs.delete(id)
    try {
        if (typeof job.destroy === 'function') job.destroy()
        else job.stop()
    } catch (error) {
        log.warn({err: error, taskId: id}, '销毁定时任务失败')
    }
}

function registerScheduledJob(id, expression) {
    const job = cron.schedule(expression, () => {
        executeScheduledTask(id).catch(error => {
            log.error({err: error, taskId: id}, '定时任务执行失败')
        })
    })
    destroyScheduledJob(id)
    cronJobs.set(id, job)
    return job
}

// ── executeScheduledTask — 执行单个定时任务 ──
// 功能说明: Cron 触发后，创建独立 session 并注入 prompt 启动 Agent 处理
//   复用 task.sessionId 可实现同一任务多轮复用上下文，未指定则新建 session
// 实现方式:
//   1. 从 scheduledTasks[id] 读取 task 配置（workDir/model/thinkingLevel 等）
//   2. 创建 PushStream → makeQueryOptions → sessions.set（permissionMode=bypassPermissions，无人值守模式）
//   3. pushStream 注入 task.prompt → startStreamPump 启动处理
//   任务失败（query 错误等）由 startStreamPump 内部的 pump 循环自动处理，不影响 cron 调度
// 关键数据流: id → scheduledTasks[id] → new session → push prompt → startStreamPump
async function executeScheduledTask(id) {
    const task = scheduledTaskStore.get(id)
    if (!task || !task.enabled) return
    if (scheduledRuns.has(id)) {
        log.warn({taskId: id}, '定时任务仍在运行，已跳过本次触发')
        return {started: false, reason: 'already_running'}
    }
    if (scheduledRuns.size >= MAX_SCHEDULED_CONCURRENT) {
        log.warn({taskId: id, active: scheduledRuns.size}, '定时任务达到并发上限，已跳过本次触发')
        return {started: false, reason: 'concurrency_limit'}
    }
    if (typeof task.prompt !== 'string' || !task.prompt.trim() || task.prompt.length > 20_000
        || !isDirectoryPath(task.workDir)) {
        throw new Error('scheduled task has invalid prompt or workDir')
    }
    log.info({taskId: id, promptLength: task.prompt?.length || 0}, '定时任务触发')
    const scheduledDecision = decideTask({text: task.prompt})
    const body = {
        workDir: task.workDir,
        text: task.prompt,
        taskDecision: scheduledDecision,
        model: task.model || MODEL,
        permissionMode: task.permissionMode || 'default',
        maxTurns: Math.min(100, Math.max(1, Number(task.maxTurns) || 20)),
    }
    const sessionId = task.sessionId || crypto.randomUUID()
    scheduledRuns.set(id, {sessionId, startedAt: Date.now(), timer: null})
    const pushStream = new PushStream()
    let opts
    try {
        const cliS = loadCliSettings()
        opts = await makeQueryOptions(body, task.workDir, cliS, {}, sessionId)
    } catch (error) {
        finishScheduledRun(id)
        throw error
    }
    if (task.sessionId) opts.resume = task.sessionId
    let q
    let eventJournal
    try {
        eventJournal = openSessionEventJournal(task.workDir, sessionId)
        q = startClaudeAgent(pushStream, opts)
    } catch (error) {
        finishScheduledRun(id)
        throw error
    }
    // 若 sessionId 已存在，先清理旧资源再覆盖，防止 WS 监听器/query 泄漏
    const old = sessions.get(sessionId)
    if (old) {
        try {
            old.pushStream?.close()
        } catch (error) {
            log.warn({err: error, taskId: id}, '关闭旧定时任务输入流失败')
        }
        try {
            await old.query?.return?.()
        } catch (error) {
            log.warn({err: error, taskId: id}, '关闭旧定时任务 query 失败')
        }
        old.query = null
        old.pushStream = null
        old.eventJournal?.close()
    }
    const scheduledSession = createSessionRuntime({
        query: q,
        pushStream,
        workDir: task.workDir,
        opts,
        identity: task.sessionId || null,
        thinkingLevel: task.thinkingLevel || 'auto',
        modelMode: opts.bridgeModelMode || 'fixed',
        agentName: 'scheduler',
        extra: {
            eventJournal,
            _onPumpDone: () => finishScheduledRun(id),
            _autoDelete: !task.sessionId,
        },
    })
    sessions.set(sessionId, scheduledSession)
    scheduledSession.taskStartedAt = Date.now()
    scheduledSession.taskCompletion = createTaskCompletionState({phase: 'running'})
    scheduledSession.taskDecision = scheduledDecision
    scheduledSession.taskCompletionDecision = scheduledDecision
    scheduledSession.taskCompletionTurnId = crypto.randomUUID()
    scheduledSession.taskCompletionTaskId = `${sessionId}:${scheduledSession.taskCompletionTurnId}`
    appendSessionEvent(scheduledSession, 'task/accepted', {
        source: 'scheduled', turnId: scheduledSession.taskCompletionTurnId, taskId: scheduledSession.taskCompletionTaskId,
    }, {critical: true})
    await initializeTaskWorkbenchSession({
        session: scheduledSession,
        sessionId,
        taskId: scheduledSession.taskCompletionTaskId,
        turnId: scheduledSession.taskCompletionTurnId,
        source: 'scheduled',
        goal: task.prompt,
        decision: scheduledDecision,
    })
    scheduledSession._taskCompletionSequence = 0
    updateTaskState(scheduledSession, sessionId, taskStateFromCompletion(scheduledSession))
    markInternalInput(scheduledSession, scheduledSession.taskDecision)
    pushStream.push({
        type: 'user', session_id: sessionId,
        message: {role: 'user', content: [{type: 'text', text: task.prompt + buildTaskPitfallReminder(scheduledSession.taskPitfallReminders)}]},
        parent_tool_use_id: null,
    })
    startStreamPump(sessionId)
    const run = scheduledRuns.get(id)
    if (run) {
        run.timer = setTimeout(() => {
            const current = sessions.get(sessionId)
            if (current !== scheduledSession) {
                finishScheduledRun(id)
                return
            }
            log.warn({taskId: id, sessionId: sessionId.slice(0, 8)}, '定时任务运行超时，正在停止')
            try {
                current.pushStream?.close()
            } catch (error) {
                log.warn({err: error, taskId: id}, '关闭超时定时任务输入流失败')
            }
            try {
                const closing = current.query?.return?.()
                Promise.resolve(closing).catch(error => {
                    log.warn({err: error, taskId: id}, '关闭超时定时任务 query 失败')
                })
            } catch (error) {
                log.warn({err: error, taskId: id}, '关闭超时定时任务 query 异常')
            }
            finishScheduledRun(id)
        }, MAX_SCHEDULED_DURATION_MS)
        run.timer.unref?.()
    }
    return {started: true, sessionId}
}

// ── resumeScheduledTasks — Gateway 启动时恢复所有已启用的定时任务 ──
// 功能说明: 从 bridge-scheduled-tasks.json 读取任务列表，逐个注册 node-cron 调度
//   任务在 cron 触发时异步执行，不相互阻塞
// 实现方式: 遍历 scheduledTasks → 过滤 enabled=true → cron.schedule(cron_expr, callback)
//   回调内 try-catch 确保单个任务失败不影响其他 cron 调度
// 关键数据流: bridge-scheduled-tasks.json → cron.schedule → executeScheduledTask
function resumeScheduledTasks() {
    for (const [id, task] of Object.entries(scheduledTaskStore.list())) {
        if (!task.enabled) continue
        if (!task.cron) {
            log.warn({taskId: id}, '定时任务缺少 cron 表达式，已跳过')
            continue
        }
        try {
            registerScheduledJob(id, task.cron)
        } catch (e) {
            log.warn({err: e, taskId: id}, '定时任务恢复失败')
        }
    }
}

    return {cronJobs, scheduledRuns, finishScheduledRun, destroyScheduledJob, registerScheduledJob, executeScheduledTask, resumeScheduledTasks}
}
