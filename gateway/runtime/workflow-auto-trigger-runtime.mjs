/**
 * Workflow Auto Trigger Runtime。
 * 负责消息策略识别、自动 Workflow 预注册及父会话关联。
 */
export function createWorkflowAutoTriggerRuntime(deps = {}) {
    const {
        loadWfConfig, shouldAutoTriggerWorkflow, classifyContextProfile,
        listWorkflows, presetRunState, sessions, createTaskWorkflowGate,
        attachTaskWorkflow, broadcastTaskLifecycle, logger = {warn() {}, error() {}, info() {}},
        broadcast, resolveWorkflowFinalReviewTier, runWfScript, now = () => Date.now(),
    } = deps
    if (!sessions || typeof runWfScript !== 'function' || typeof loadWfConfig !== 'function') {
        throw new TypeError('workflow auto trigger dependencies are required')
    }

const WF_TIER_MAP = {
    'code-review': 'power',
    'bug-hunter': 'power',
    'audit-sweep': 'power',
    'deep-research': 'power',
    'judge-panel': 'power',
    'generate-critic-fix': 'balanced',
    'default': 'balanced',
}
const WORKFLOW_TRIGGERS = [
    {name: 'code-review', kw: ['审查', 'review', '检查代码', 'code review', '审阅', 'cr', '帮我review', 'codereview']},
    {name: 'bug-hunter', kw: ['找bug', 'bug', '缺陷', 'debug', 'exception', 'stack trace', '空指针', '死锁', '竞态', 'race condition', '内存泄漏', 'null pointer']},
    {name: 'audit-sweep', kw: ['审计', 'audit', '全面检查', 'sweep', '扫描漏洞', '安全审计', '安全审查']},
    {name: 'deep-research', kw: ['调研', 'research', '竞品分析', '对比一下市面', '深入分析']},
    {name: 'judge-panel', kw: ['方案对比', '选哪个', '比较优劣', '哪个好', '怎么选', '权衡利弊', '架构决策', '技术对比']},
    {name: 'generate-critic-fix', kw: ['fix这个', '补丁', 'patch', '修正一下', '修这个bug', '改这个bug']},
]

function analyzeMessageForWorkflow(text) {
    if (!text || typeof text !== 'string') return null
    const lower = text.toLowerCase()
    for (const wf of WORKFLOW_TRIGGERS) {
        for (const k of wf.kw) {
            if (lower.includes(k.toLowerCase())) return wf.name
        }
    }
    // 高复杂度信号: 含代码块 + >100 字 → 兜底触发 default；纯长文本不自动触发
    if (text.length > 100 && text.includes('```')) return 'default'
    // 明确不需要 workflow 的问句: 简单问答、解释、闲聊
    if (/^(什么是|怎么|如何|为什么|what|how|why|帮我解释|hello|hi|你好)/i.test(text) && text.length < 50) return '__skip__'
    return null
}

async function autoTriggerWorkflow(sessionId, msgContent, taskDecision = null) {
    const wfCfg = loadWfConfig()
    if (!wfCfg.enabled) return
    if (taskDecision && !shouldAutoTriggerWorkflow(taskDecision)) return
    if (!taskDecision && classifyContextProfile(msgContent) === 'light') return

    let matchedWf = taskDecision?.workflow && taskDecision.workflow !== 'none'
        ? taskDecision.workflow
        : null
    const kwResult = matchedWf ? null : analyzeMessageForWorkflow(msgContent)
    if (!matchedWf && kwResult === '__skip__') return
    if (!matchedWf) matchedWf = kwResult
    if (!matchedWf || matchedWf === '__skip__') return

    const wfList = listWorkflows()
    const exists = wfList.some(w => w.enabled !== false && w.name.replace('.mjs', '') === matchedWf)
    if (!exists) return

    let wfId
    try {
        // 先预注册真实运行状态，广播的 ID 与 runWfScript 内部使用的 ID 保持一致；
        // 同名 Workflow 已在运行时直接跳过，避免自动触发覆盖手工运行。
        wfId = presetRunState(matchedWf, `${matchedWf}:${sessionId}`, sessionId)
        const session = sessions.get(sessionId)
        if (!session._taskWorkflowGate) session._taskWorkflowGate = createTaskWorkflowGate()
        attachTaskWorkflow(session._taskWorkflowGate, wfId)
        broadcastTaskLifecycle(sessionId)
    } catch (error) {
        if (error?.code !== 'WORKFLOW_ALREADY_RUNNING') {
            logger.warn({err: error, sessionId: sessionId?.slice(0, 8), workflow: matchedWf}, '自动 Workflow 预注册失败')
        }
        return
    }
    logger.info({sessionId: sessionId?.slice(0, 8), workflow: matchedWf, wfId}, '自动启动 workflow')
    broadcast(sessionId, {
        type: 'workflow_auto_started',
        workflowId: wfId,
        name: matchedWf,
        task: msgContent.slice(0, 100),
        ts: Date.now(),
    })
    const requestedTier = taskDecision?.finalReview && taskDecision.finalReview !== 'none'
        ? taskDecision.finalReview
        : taskDecision?.modelTier || WF_TIER_MAP[matchedWf] || 'balanced'
    const workflowTier = ['code-review', 'bug-hunter', 'audit-sweep', 'generate-critic-fix'].includes(matchedWf)
        ? resolveWorkflowFinalReviewTier({risk: taskDecision?.risk, requestedTier})
        : requestedTier
    runWfScript(matchedWf, sessionId, {
        task: msgContent,
        // Workflow 子进程不公开 process.cwd()；仅由会话上下文注入已校验的目标目录。
        path: sessions.get(sessionId)?.workDir || '.',
        _workflowTier: workflowTier,
        _modelTiers: wfCfg.modelTiers || {},
        _fixedModel: sessions.get(sessionId)?.modelMode === 'fixed'
            ? sessions.get(sessionId)?.queryOpts?.model || null
            : null,
        _taskDecision: taskDecision || null,
        // 自动 Workflow 必须继承当前会话权限；否则主会话的 bypassPermissions 会在子 Agent 链路丢失。
        _permissionMode: sessions.get(sessionId)?.permissionMode || 'default',
        _taskId: sessions.get(sessionId)?.coordinatorTaskId || sessions.get(sessionId)?.taskCompletionTaskId || null,
        _projectContext: sessions.get(sessionId)?.projectContext || null,
        _taskOwned: true,
        _runKey: `${matchedWf}:${sessionId}`,
    }).catch(e => {
        logger.error({err: e, sessionId: sessionId?.slice(0, 8), workflow: matchedWf}, '自动 workflow 失败')
    })
}


    return {analyzeMessageForWorkflow, autoTriggerWorkflow}
}
