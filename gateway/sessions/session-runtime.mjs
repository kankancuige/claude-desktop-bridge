import {initialSessionIdentity} from './session-create-mode.mjs'
import {createTaskCompletionState} from '../tasks/task-completion.mjs'
import {createTaskStatePatch} from '../tasks/task-state.mjs'
import {createTaskWorkflowGate} from '../tasks/task-workflow-gate.mjs'
import {buildContextEnvelope} from '../context/context-envelope.mjs'

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
        _autoContinuationRequest: null,
        _pendingSources: [],
        _pendingTurns: [],
        _pendingInputs: [],
        _inputIds: new Map(),
        activeTurnId: null,
        activeTurnIdentity: null,
        depth,
        ...extra,
    }
    runtime.contextEnvelope = createSessionContextEnvelope(runtime, opts)
    return runtime
}
