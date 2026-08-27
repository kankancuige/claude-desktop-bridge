import {initialSessionIdentity} from './session-create-mode.mjs'
import {createTaskCompletionState} from '../tasks/task-completion.mjs'
import {createTaskStatePatch} from '../tasks/task-state.mjs'
import {createTaskWorkflowGate} from '../tasks/task-workflow-gate.mjs'
import {buildContextEnvelope} from '../context/context-envelope.mjs'
import {createCleanupRegistry} from './cleanup-registry.mjs'
import {createRuntimeDiagnostics} from './runtime-diagnostics.mjs'
import {createTaskRunBudget} from '../tasks/task-run-budget.mjs'

async function closeWithTimeout(value, timeoutMs = 5000) {
    if (!value || typeof value.then !== 'function') return
    let timer
    try {
        await Promise.race([
            Promise.resolve(value),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cleanup timeout')), timeoutMs) }),
        ])
    } finally {
        clearTimeout(timer)
    }
}

async function closeQueryRuntime(runtime, reason = 'session_closed') {
    const query = runtime?.query
    const controller = runtime?.queryOpts?.abortController
    try {
        if (typeof query?.close === 'function') {
            query.close()
        } else {
            await closeWithTimeout(query?.return?.())
        }
    } finally {
        if (controller && !controller.signal.aborted) controller.abort(reason)
    }
}

/**
 * 只把匿名、稳定的运行配置投影给上下文策略；Prompt、凭据和工作目录不进入 envelope。
 */
export function createSessionContextEnvelope(session = {}, opts = session.queryOpts || {}) {
    return buildContextEnvelope({
        providerIdentity: opts.bridgeProviderBaseUrl || session.providerBaseUrl || 'claude-agent-sdk-default',
        model: opts.model || 'unknown-model',
        protocolFamily: 'claude-agent-sdk',
        resumeSessionId: session.lastSessionId || opts.resume || '',
        permissionMode: session.permissionMode || opts.permissionMode,
        thinkingLevel: session.thinkingLevel,
        contextProfile: session.contextProfile || opts.bridgeContextProfile,
        skillRoute: session.skillRoute || opts.bridgeSkillRoute,
        agentRoute: session.loadedAgentRoute || Object.keys(opts.agents || {}).sort(),
        toolsetRevision: opts.bridgeToolsetRevision,
        ruleRevision: opts.bridgeRuleRevision,
        projectContextRevision: opts.bridgeProjectContextRevision,
    })
}

export function createSessionRuntime({
    query = null,
    pushStream = null,
    workDir,
    opts = {},
    identity = null,
    modelMode = null,
    thinkingLevel = 'auto',
    agentName = 'main',
    depth = 0,
    extra = {},
} = {}) {
    if (!opts.abortController) opts.abortController = new AbortController()
    const runtime = {
        query,
        pushStream,
        workDir,
        clients: new Set(),
        createdAt: Date.now(),
        pending: new Map(),
        permissionMode: opts.permissionMode || 'default',
        thinkingLevel,
        modelMode: modelMode || opts.bridgeModelMode || 'auto',
        providerBaseUrl: opts.bridgeProviderBaseUrl || '',
        providerApiKey: opts.bridgeProviderApiKey || '',
        mirrors: {wechat: false, feishu: false, dingtalk: false},
        queryOpts: opts,
        runtimeEnv: opts.runtimeEnv,
        contextProfile: opts.bridgeContextProfile || 'full',
        taskDecision: opts.bridgeTaskDecision || null,
        modelTier: opts.bridgeModelTier || null,
        taskCompletion: createTaskCompletionState(),
        taskState: createTaskStatePatch({
            status: 'idle', outcome: null, continuationReason: null, resumable: false,
            sdkSessionId: identity, historySessionId: identity,
            model: opts.model,
        }),
        eventJournal: null,
        _taskWorkflowGate: createTaskWorkflowGate(),
        skillRoute: opts.bridgeSkillRoute || [],
        ...initialSessionIdentity(identity),
        forkedFrom: null,
        parentSessionId: null,
        agentName,
        taskId: null,
        children: new Set(),
        turnText: '',
        turnToolCount: 0,
        autoContinuationCount: 0,
        autoContinuationTurns: 0,
        _taskRunBudget: createTaskRunBudget(opts.bridgeTaskDecision?.continuationPolicy || {}, opts.bridgeTaskDecision?.executionMode || 'session'),
        _lastContinuationFingerprint: null,
        _autoContinuationRequest: null,
        _pendingSources: [],
        _pendingTurns: [],
        _pendingInputs: [],
        _inputIds: new Map(),
        activeTurnId: null,
        activeTurnIdentity: null,
        // 当前 SDK 工具调用的活动快照，供 watchdog 区分长工具和断流。
        _activeTools: new Map(),
        _streamWatchdogStartedAt: 0,
        depth,
        ...extra,
    }
    runtime.cleanupRegistry = extra.cleanupRegistry || createCleanupRegistry({parentSignal: extra.parentSignal || null})
    runtime.diagnostics = extra.diagnostics || createRuntimeDiagnostics()
    runtime.cleanupRegistry.register('query', async reason => {
        await closeQueryRuntime(runtime, reason)
    }, 'session-query')
    runtime.cleanupRegistry.register('stream', () => runtime.pushStream?.close(), 'session-push-stream')
    runtime.cleanupRegistry.register('watchdog', () => {
        if (runtime._streamWatchdogTimer) clearTimeout(runtime._streamWatchdogTimer)
        runtime._streamWatchdogTimer = null
        runtime._streamWatchdogQuery = null
    }, 'session-watchdog')
    runtime.newCleanupRegistry = () => {
        runtime.cleanupRegistry = createCleanupRegistry({parentSignal: extra.parentSignal || null})
        runtime.cleanupRegistry.register('query', async reason => {
            await closeQueryRuntime(runtime, reason)
        }, 'session-query')
        runtime.cleanupRegistry.register('stream', () => runtime.pushStream?.close(), 'session-push-stream')
        runtime.cleanupRegistry.register('watchdog', () => {
            if (runtime._streamWatchdogTimer) clearTimeout(runtime._streamWatchdogTimer)
            runtime._streamWatchdogTimer = null
            runtime._streamWatchdogQuery = null
        }, 'session-watchdog')
        return runtime.cleanupRegistry
    }
    runtime.contextEnvelope = createSessionContextEnvelope(runtime, opts)
    return runtime
}
