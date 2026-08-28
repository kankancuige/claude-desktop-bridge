/**
 * Claude Desktop Bridge — Gateway (SDK 0.3.179)
 * https://github.com/kankancuige/claude-desktop-bridge
 * query() + PushStream — MCP/工具直接透传，兼容 DeepSeek。
 */

import {createServer} from 'node:http'
import {readdirSync, statSync, lstatSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, rmdirSync, renameSync, rmSync, openSync, readSync, closeSync} from 'node:fs'
import {execFileSync, execSync, spawn, spawnSync} from 'node:child_process'
import crypto from 'node:crypto'
import {homedir} from 'node:os'
import {join, dirname, basename, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {WebSocketServer} from 'ws'
import {config as loadEnv} from 'dotenv'
import {safeBasename, safeChildPath} from './security/path-security.mjs'
import {query, deleteSession, forkSession} from './providers/claude-agent-sdk-runtime.mjs'
import {BRIDGE_HOME, prepareBridgeHome} from './config/bridge-home.mjs'
import {getBuiltinResourceState, setBuiltinResourceEnabled} from './config/builtin-resources.mjs'
import {normalizeStreamWatchdogConfig} from './config/stream-watchdog-config.mjs'
import {createLogger, logHttpRequest} from './shared/logger.mjs'
import {buildSessionStopResponse, getSessionStopScope, hasStoppableSessionWork, resolvePrimaryStopTurnId, selectCancelledInputTurns} from './sessions/session-stop.mjs'
import {resolveSessionResume} from './sessions/session-resume.mjs'
import {consumePendingSessionInputOnResult, getSessionRuntimeState} from './sessions/session-runtime-state.mjs'
import {classifyTranscriptFile} from './projects/transcript-classifier.mjs'
import {parseSessionHistory} from './sessions/session-history.mjs'
import {findSessionTranscript, listProjectTranscriptCandidates, resolveSessionTranscript as resolveSessionTranscriptLocation} from './projects/project-transcript-location.mjs'
import {removeSessionMapEntry, resolveMappedGatewaySessionId, updateSessionMap} from './sessions/session-map-consistency.mjs'
import {isUserSessionSource, loadSessionVisibility, markSessionVisible, migrateLegacySessionVisibility, removeSessionVisibility, sessionVisibilitySource, shouldShowSession} from './sessions/session-visibility.mjs'
import {initialSessionIdentity, resolveRecoveryRuntimeIdentity, resolveSessionCreateMode} from './sessions/session-create-mode.mjs'
import {createSessionContextEnvelope, createSessionRuntime} from './sessions/session-runtime.mjs'
import {createSdkStreamAdapter} from './sessions/sdk-stream-adapter.mjs'
import {resolveSessionLink} from './sessions/session-link-resolver.mjs'
import {getPersistedMirrors, mirrorSessionIds, mirrorStorePath, removePersistedMirrors, setPersistedMirror, setPersistedMirrors} from './sessions/session-mirror-state.mjs'
import {reconcileSessionCatalog} from './sessions/session-catalog.mjs'
import {buildModelHandoffPrompt, buildProjectContinuationContext, composeContinuationPrompt} from './projects/project-continuation-context.mjs'
import {buildAgentDescriptor} from './agents/agent-tool-lifecycle.mjs'
import {startWeChatAdapter} from './im/wechat.mjs'
import {startFeishuAdapter} from './im/feishu.mjs'
import {startDingTalkAdapter} from './im/dingtalk.mjs'
import {
    listWorkflows,
    getWorkflow,
    saveWorkflow,
    validateWorkflowContent,
    deleteWorkflow as deleteWorkflowFile,
    runWorkflow as runWfScript,
    createWorkflowRuntime,
    parseMeta,
    getRunState,
    getSessionWorkflowState,
    getSessionWorkflowStates,
    presetRunState,
    stopWorkflow,
    stopWorkflowAgent,
    resumeWorkflowAgent,
    resumeWorkflow,
    commitWorkflow,
    queryHistory,
} from './workflows/workflow-runner.mjs'
import {
    buildProjectCache,
    loadProjectCache,
    saveProjectCache,
    updateProjectCache,
    isExplorationAttempt,
    buildCacheInjectionText,
    cacheFilePath
} from './projects/project-cache.mjs'
import {loadOrBuildProjectContext} from './projects/project-context.mjs'
import {validateProviderUrl, buildProviderModelsUrl, buildProviderFallbackUrls} from './security/provider-url-security.mjs'
import {upsertAdapterBinding} from './im/adapter-bindings.mjs'
import {loadPairedUserCount} from './im/paired-users.mjs'
import {scheduleSessionBackgroundInitialization} from './sessions/session-background-init.mjs'
import {
    buildIncompleteMirrorText,
    canResumeTask,
    classifyTaskResult,
    looksLikeIncompleteTransportFailure,
} from './tasks/task-result-outcome.mjs'
import {isAutoContinuationPrompt, resolveAutoContinuation} from './tasks/task-auto-continuation.mjs'
import {createTaskStatePatch, recoverTaskState, taskStateForClient, taskStateForError, taskStateForInconclusive, taskStateForStop, taskStateFileId} from './tasks/task-state.mjs'
import {clearPlatformEntries, platformEntryFilePath} from './im/platform-entry-store.mjs'
import {createTurnIdentity, shouldDeliverTurnEvent, shouldRouteMirror} from './tasks/turn-routing.mjs'
import {normalizeWeChatBaseUrl} from './im/wechat-url.mjs'
import {sendManualImText} from './im/manual-im-send.mjs'
import {createAdapterConfigRuntime} from './runtime/adapter-config-runtime.mjs'
import {configureSecurePayloadMasterKey} from './security/secure-payload.mjs'
import {extractWebSocketToken} from './security/websocket-auth.mjs'
import {redactSecretMap, restoreSecretMap, restoreSecretValue} from './security/config-redaction.mjs'
import {buildWindowsRtkExtractArgs, buildWindowsRtkExtractEnv, selectRtkReleaseAsset, verifyRtkAssetDigest} from './tools/rtk-archive.mjs'
import {extractBridgeProviderSettings, overlayBridgeProviderSettings, stripBridgeProviderSettings} from './providers/bridge-provider-settings.mjs'
import {applyContextProfile, classifyContextProfile, normalizeContextProfile} from './context/context-profile.mjs'
import {decideTask} from './tasks/task-decision.mjs'
import {shouldCaptureTurnCheckpoint} from './tasks/turn-checkpoint-policy.mjs'
import {normalizeExplicitModel, resolveTaskModelRoute, resolveTurnModelRoute, shouldDeferAutomaticQuery, shouldValidateProviderModel, validateProviderModel} from './tasks/model-routing.mjs'
import {resolveWorkflowFinalReviewTier, shouldAutoTriggerWorkflow} from './workflows/workflow-model-routing.mjs'
import {createTaskCompletionState, hasPersistedNotificationIntents, normalizeReviewOutcome, resolveFinalReviewPlan, resolveRequiredNotificationPlatforms, transitionTaskCompletion} from './tasks/task-completion.mjs'
import {createTaskLifecycleSnapshot} from './tasks/task-lifecycle.mjs'
import {createTaskCommandService} from './tasks/task-command.mjs'
import {createTaskPlan} from './tasks/task-plan.mjs'
import {resolveTaskPhases} from './tasks/task-phase.mjs'
import {createTaskCoordinator} from './tasks/task-coordinator.mjs'
import {restoreCoordinatorSnapshot} from './tasks/coordinator-compatibility.mjs'
import {createCoordinatorPersistence} from './tasks/coordinator-persistence.mjs'
import {createTaskWorkbenchRuntime} from './tasks/task-workbench-runtime.mjs'
import {BUILTIN_AGENT_DEFINITIONS, createAgentRegistry, resolveAgents as resolveTaskAgents} from './agents/agent-registry.mjs'
import {createVerificationAdapterRegistry} from './validation/verification-adapter.mjs'
import {createCommandVerificationAdapter} from './validation/command-adapter.mjs'
import {createVerificationCampaignService} from './validation/verification-campaign.mjs'
import {SessionEventJournal, journalTaskState, sessionEventStorePath} from './sessions/session-event-journal.mjs'
import {requirementsForAgentStart} from './agents/agent-capabilities.mjs'
import {createProviderRegistry} from './providers/provider-registry.mjs'
import {
    attachTaskWorkflow,
    clearTaskWorkflowGate,
    consumeTaskWorkflowResultTurn,
    createTaskWorkflowGate,
    deferPrimaryResultForTaskWorkflow,
    finishTaskWorkflowResultTurn,
    hasPendingTaskWorkflow,
    noteTaskWorkflowTerminal,
    takeDeferredPrimaryResult,
    taskWorkflowResultIdFromMessage,
    isInternalWorkflowResultText,
} from './tasks/task-workflow-gate.mjs'
import {applySkillRoute, routeSkills} from './agents/skill-router.mjs'
import {ensureBuiltinSkillsAvailable} from './agents/builtin-skill-installer.mjs'
import {buildSystemInitEvent} from './sessions/session-init-event.mjs'
import {resolveResumeModel} from './sessions/session-resume-model.mjs'
import {resolveRtkCommandArgs} from './tools/rtk-command.mjs'
import {describeAttachment, isImageAttachment} from './tools/attachment-type.mjs'
import {cleanupUploadDir, prepareUploadDir} from './tools/upload-storage.mjs'
import {parseDeepSeekBalance, resolveBalanceProvider} from './providers/balance-provider.mjs'
import {createUserPreferenceService} from './context/user-preferences.mjs'
import {createPitfallService} from './context/pitfall-service.mjs'
import {createPitfallAdmin} from './context/pitfall-admin.mjs'
import {checkAiLayerHealth, detectRuleDrift} from './context/ai-layer-health.mjs'
import {readStorageConfigFile} from './storage/storage-config-file.mjs'
import {ensurePostgresSchema} from './storage/postgres-schema.mjs'
import {createStorageGateway} from './storage/storage-gateway.mjs'
import {createPostgresStateCompat} from './storage/postgres-state-compat.mjs'
import {createMemoryService} from './context/memory-service.mjs'
import {
    deleteProjectMemory,
    deleteProjectMemoryAsync,
    listProjectMemory,
    listProjectMemoryAsync,
    rebuildProjectMemory,
    rebuildProjectMemoryAsync,
    saveProjectMemory,
    saveProjectMemoryAsync,
    setProjectMemoryEnabled,
    setProjectMemoryEnabledAsync,
} from './context/memory-admin.mjs'
import {createImProgressReporter} from './im/im-progress-reporter.mjs'
import {createImProgressPolicy} from './im/im-progress-policy.mjs'
import {
    calculateAutoCompactWindow,
    compactBoundaryToEvent,
    contextUsageEvent,
    isSyntheticCompactSummary,
    parseTokenCount,
} from './context/context-lifecycle.mjs'
import {resolveContextReusePolicy} from './context/context-cache-policy.mjs'
import {resolveProviderCapabilityProfile} from './providers/provider-capability-profile.mjs'
import {createModelUsageEvent} from './context/model-usage.mjs'
import {createResourceConfigRoutes} from './http/resource-config-routes.mjs'
import {createConfigRoutes} from './http/config-routes.mjs'
import {createHttpRuntime} from './runtime/http-runtime.mjs'
import {createSessionRuntimeService} from './runtime/session-runtime-service.mjs'
import {createSdkStreamRuntime} from './runtime/sdk-stream-runtime.mjs'
import {createWebSocketGateway} from './runtime/websocket-gateway.mjs'
import {createShutdownRuntime} from './runtime/shutdown-runtime.mjs'
import {createProjectRuntime} from './runtime/project-runtime.mjs'
import {createTaskCommandRuntime} from './runtime/task-command-runtime.mjs'
import {createWebSocketSessionRuntime} from './runtime/websocket-session-runtime.mjs'
import {createScheduledRuntime} from './runtime/scheduled-runtime.mjs'
import {createScheduledTaskStore} from './runtime/scheduled-task-store.mjs'
import {createImRuntime} from './runtime/im-runtime.mjs'
import {createSessionContextRuntime} from './runtime/session-context-runtime.mjs'
import {createContextPlanner} from './context/context-planner.mjs'
import {createAgentMailbox} from './agents/agent-message.mjs'
import {createMemoryCandidateStore} from './context/memory-candidate.mjs'
import {extractAutomaticMemoryFactsFromSession} from './context/memory-auto-capture.mjs'
import {createMemoryAutoCaptureRuntime} from './runtime/memory-auto-capture-runtime.mjs'
import {createProjectSessionRuntime} from './runtime/project-session-runtime.mjs'
import {createProviderRuntime} from './runtime/provider-runtime.mjs'
import {createProjectGitRuntime} from './runtime/project-git-runtime.mjs'
import {createSessionIdentityRuntime} from './runtime/session-identity-runtime.mjs'
import {createTaskCompletionEventRuntime} from './runtime/task-completion-event-runtime.mjs'
import {createTaskCompletionEffectsRuntime} from './runtime/task-completion-effects-runtime.mjs'
import {createSessionArtifactRuntime} from './runtime/session-artifact-runtime.mjs'
import {createCoordinatorVerificationRuntime} from './runtime/coordinator-verification-runtime.mjs'
import {BINARY_EXTS, MAX_SNAP_FILE_BYTES, MAX_SNAP_FILES, SNAP_EXCLUDE_DIRS, createProjectFileRuntime} from './runtime/project-file-runtime.mjs'
import {createSessionCleanupRuntime} from './runtime/session-cleanup-runtime.mjs'
import {createTaskStateStorageRuntime} from './runtime/task-state-storage-runtime.mjs'
import {createSessionStateStorageRuntime} from './runtime/session-state-storage-runtime.mjs'
import {createSessionInputRuntime} from './runtime/session-input-runtime.mjs'
import {createSessionStopRuntime} from './runtime/session-stop-runtime.mjs'
import {createTaskLifecycleRuntime} from './runtime/task-lifecycle-runtime.mjs'
import {createSessionBroadcastRuntime} from './runtime/session-broadcast-runtime.mjs'
import {createConfigFileRuntime} from './runtime/config-file-runtime.mjs'
import {createBridgeAuthRuntime} from './runtime/bridge-auth-runtime.mjs'
import {createConfirmationRuntime} from './runtime/confirmation-runtime.mjs'
import {createRequestRuntime} from './runtime/request-runtime.mjs'
import {createSessionResourceRuntime} from './runtime/session-resource-runtime.mjs'
import {createDynamicCacheRuntime} from './runtime/dynamic-cache-runtime.mjs'
import {createSecurePayloadRuntime} from './runtime/secure-payload-runtime.mjs'
import {createAgentRegistryRuntime} from './runtime/agent-registry-runtime.mjs'
import {createWorkflowBroadcastRuntime} from './runtime/workflow-broadcast-runtime.mjs'
import {createCoordinatorRcaRuntime} from './runtime/coordinator-rca-runtime.mjs'
import {createToolingUpdateRuntime} from './runtime/tooling-update-runtime.mjs'
import {createQueryOptionsRuntime} from './runtime/query-options-runtime.mjs'
import {createProjectCacheIntegrationRuntime} from './runtime/project-cache-integration-runtime.mjs'
import {createClaudeExecutableRuntime} from './runtime/claude-executable-runtime.mjs'
import {createStartupRuntime} from './runtime/startup-runtime.mjs'
import {createHookValidationRuntime} from './runtime/hook-validation-runtime.mjs'
import {createWorkflowConfigRuntime} from './runtime/workflow-config-runtime.mjs'
import {createWeChatChunkRuntime} from './runtime/wechat-chunk-runtime.mjs'
import {createGatewayServiceRuntime} from './runtime/gateway-service-runtime.mjs'
import {mapThinkingLevel} from './runtime/query-option-mappers.mjs'
import {PROVIDERS, parseContextWindow, parsePricingPrice, lookupModelInfo} from './providers/provider-model-catalog.mjs'
import {createFinalReviewRuntime} from './runtime/final-review-runtime.mjs'
import {createWorkflowAutoTriggerRuntime} from './runtime/workflow-auto-trigger-runtime.mjs'
import {createTaskInputQueue} from './sessions/task-input-queue.mjs'
import {createSessionCoordinator} from './sessions/session-coordinator.mjs'
import {createSessionUploadRuntime} from './runtime/session-upload-runtime.mjs'
import {PushStream} from './runtime/push-stream.mjs'
// 同一项目只允许一个后台索引任务，避免连续新建会话重复扫描同一目录。
const PROJECT_CACHE_IDLE_DELAY_MS = 1500
let projectRuntime = null
function scheduleProjectCacheBuild(workDir) {
    return projectRuntime?.schedule(workDir) || null
}
import cron from 'node-cron'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({path: join(__dirname, '.env'), override: true})
const log = createLogger('gateway')
const configFileRuntime = createConfigFileRuntime({
    readFileSync,
    writeFileSync,
    mkdirSync,
    dirname,
    renameSync,
    unlinkSync,
    logger: log,
})
const {readJSON, writeJSON, backupFile, parseFrontmatter} = configFileRuntime
const WF_CONFIG_FILE = join(BRIDGE_HOME, 'bridge-workflow.json')
const workflowConfigRuntime = createWorkflowConfigRuntime({filePath: WF_CONFIG_FILE, readJSON, writeJSON})
const {loadWfConfig, saveWfConfig} = workflowConfigRuntime
const requestRuntime = createRequestRuntime({imSources: new Set(['wechat', 'feishu', 'dingtalk'])})
const {
    CHILD_ENV_KEYS, decodeProjectName, normalizeWorkDir, encodeProjectName, readBody, parseMultipart,
    sanitizeMcpServers, buildChildProcessEnv, getAdapterIdentity, adapterRouteAllowed,
} = requestRuntime
const agentRegistryRuntime = createAgentRegistryRuntime({
    bridgeHome: BRIDGE_HOME,
    builtinDefinitions: BUILTIN_AGENT_DEFINITIONS,
    createAgentRegistry,
    getBuiltinResourceState,
    resolveTaskAgents,
    readdirSync,
    readFileSync,
    join,
    parseFrontmatter,
    logger: log,
})
const {loadAgentDefinitions, createRuntimeAgentRegistry} = agentRegistryRuntime
const projectFileRuntime = createProjectFileRuntime({
    existsSync,
    readdirSync,
    statSync,
    readFileSync,
    execSync,
    safeChildPath,
    relativePath: relative,
    joinPath: join,
    logger: log,
})
const sessionCleanupRuntime = createSessionCleanupRuntime({
    bridgeHome: BRIDGE_HOME,
    readdirSync,
    statSync,
    existsSync,
    unlinkSync,
    rmSync,
    openSync,
    readSync,
    closeSync,
    logger: log,
})
const {readFileHeadLines, cleanupOrphanSessionDirs} = sessionCleanupRuntime
const sessionStateStorageRuntime = createSessionStateStorageRuntime({
    bridgeHome: BRIDGE_HOME,
    joinPath: join,
    encodeProjectName,
    normalizeWorkDir,
    mirrorStorePath,
    mirrorSessionIds,
    getPersistedMirrors,
    setPersistedMirror,
    setPersistedMirrors,
    removePersistedMirrors,
    readJSON,
    writeJSON,
    existsSync,
    statSync,
    getSessionRepository: () => stateRepositories()?.session,
    isUserSessionSource,
    SessionEventJournal,
    sessionEventStorePath,
    logger: log,
})
const {
    sessionMirrorStorePath,
    sessionMirrorIds,
    sessionCatalogProjectKey,
    sessionCatalogIds,
    ensureSessionCatalogIdentity,
    readSessionCatalogSettings,
    persistSessionCatalogSettings,
    restoreSessionMirrors,
    persistSessionMirrors,
    removePersistedSessionMirrors,
    openSessionEventJournal,
    appendSessionEvent,
} = sessionStateStorageRuntime
const taskStateStorageRuntime = createTaskStateStorageRuntime({
    bridgeHome: BRIDGE_HOME,
    encodeProjectName,
    joinPath: join,
    taskStateFileId,
    readJSON,
    writeJSON,
    recoverTaskState,
    sessionCatalogProjectKey,
    getWorkbenchRepository: () => stateRepositories()?.workbench,
    looksLikeIncompleteTransportFailure,
    logger: log,
})
const {taskStateStorePath, saveTaskState, loadTaskState, persistTaskStateProjection, repairPersistedTaskState} = taskStateStorageRuntime
const {
    isBinaryPath,
    resolveSafe,
    currentFileScan,
    buildFileSnapshot,
    lineDiffStats,
    computeLineDiff,
    diffSnapshotVsCurrent,
} = projectFileRuntime
projectRuntime = createProjectRuntime({
    cacheFilePath,
    exists: existsSync,
    buildCache: buildProjectCache,
    saveCache: saveProjectCache,
    logger: log,
    idleDelayMs: PROJECT_CACHE_IDLE_DELAY_MS,
})
const projectCacheBuilds = projectRuntime.builds
let bridgeStateDb = null
let storageGateway = null
let taskCoordinator = null
let taskWorkbench = null
let pitfallService = null
let pitfallAdmin = null
let memoryService = null
let agentMailbox = null
let memoryCandidateStore = null
const memoryAutoCaptureRuntime = createMemoryAutoCaptureRuntime({
    getCandidateStore: () => memoryCandidateStore,
    extractFacts: extractAutomaticMemoryFactsFromSession,
    encodeProjectName,
})
let stateRepositories = () => storageGateway?.repositories || {}
// Health contract keeps stateStoreDegradedReason: for desktop compatibility.
// stateStoreDegradedReason:
const stateStoreDegradedReason = () => bridgeStateDb?.degradedReason || null

const providerRegistry = createProviderRegistry({
    onDisposeError: (error, context) => log.warn({err: error, ...context}, 'Agent Provider 释放失败'),
})
providerRegistry.register('agent', 'claude-sdk', {
    start: ({prompt, options}) => query({prompt, options}),
    // SDK query 由 Session/Workflow 持有并先行关闭，Provider 本身没有额外常驻资源。
    dispose: async () => {},
}, {
    writable: true,
    resumable: true,
    modelOverride: true,
    structuredOutput: true,
    toolFiltering: true,
    continuation: true,
})
const claudeAgentProvider = providerRegistry.require('agent', 'claude-sdk')
const gatewayServiceRuntime = createGatewayServiceRuntime({getStorageGateway: () => storageGateway, agentProvider: claudeAgentProvider, requirementsForAgentStart})
stateRepositories = gatewayServiceRuntime.stateRepositories
const startClaudeAgent = gatewayServiceRuntime.startClaudeAgent

// ── 版本号（读取本 package.json 的 version 字段）──
const PKG_VERSION = (() => {
    try { return JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')).version || '0.0.0' } catch { return '0.0.0' }
})()

const PORT = parseInt(process.env.PORT || '3456', 10)
// 默认使用 Agent SDK 配套的 native binary；用户显式设置 CLAUDE_EXE/claudeExe 时仍可覆盖。
const bundledClaudeExecutable = (() => {
    const executable = process.platform === 'win32' ? 'claude.exe' : 'claude'
    const candidates = [
        join(__dirname, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, executable),
        ...(process.platform === 'linux'
            ? [join(__dirname, 'node_modules', '@anthropic-ai', `claude-agent-sdk-linux-${process.arch}-musl`, executable)]
            : []),
    ]
    return candidates.find(path => existsSync(path)) || null
})()
const claudeExecutableRuntime = createClaudeExecutableRuntime({
    homedir, join, dirname, existsSync, readdirSync, statSync, execSync,
    loadCliSettings: () => loadCliSettings(), bundledExecutable: bundledClaudeExecutable, logger: log,
})
const {resolveFromPkgDir, getClaudeExe, setClaudeExe} = claudeExecutableRuntime
const MODEL = process.env.ANTHROPIC_MODEL || 'deepseek-v4-pro'
// 模型名直传，不做映射；缺失值必须保持为空，由调用点按当前 Bridge 供应商配置回退。
function mapModel(name) {
    return normalizeExplicitModel(name)
}

const userPreferences = createUserPreferenceService({
    bridgeHome: BRIDGE_HOME,
    onWarning: (error, context) => log.warn({err: error, ...context}, '用户偏好存储降级'),
})
const BRIDGE_TOKEN_PATH = join(BRIDGE_HOME, 'bridge-token')
const BRIDGE_PROVIDER_SETTINGS_PATH = join(BRIDGE_HOME, 'bridge-provider.json')
const ADAPTER_SESSIONS_PATH = join(BRIDGE_HOME, 'adapter-sessions.json')
const ADAPTER_CONFIG_PATH = join(BRIDGE_HOME, 'adapters.json')
const SECURE_PAYLOAD_KEY_PATH = join(BRIDGE_HOME, 'bridge-store-key')
const providerRuntime = createProviderRuntime({
    bridgeHome: BRIDGE_HOME,
    model: MODEL,
    providerSettingsPath: BRIDGE_PROVIDER_SETTINGS_PATH,
    settingsPath: join(BRIDGE_HOME, 'settings.json'),
    readJSON,
    writeJSON: (path, value) => writeJSON(path, value),
    logger: log,
})
const {
    loadBridgeProviderSettings,
    saveBridgeProviderSettings,
    loadCliSettings,
    loadCliSettingsForUpdate,
    fetchProviderResponse,
    prepareQueryProvider,
} = providerRuntime
// 本地 API 认证 token: 启动时生成随机 token，写入文件供桌面端读取
// 所有 POST/PUT/DELETE 请求须携带 x-bridge-token header 与此匹配
const BRIDGE_TOKEN = crypto.randomUUID()
const ALLOW_TOKEN_ENDPOINT = process.env.BRIDGE_ALLOW_TOKEN_ENDPOINT === '1'
const ADAPTER_PLATFORMS = ['wechat', 'feishu', 'dingtalk']
const NUDGE_ACTIONS = new Set(['switch_project', 'switch_session', 'new_session', 'toggle_mirror', 'stop'])
// Adapter 只拿到按平台派生的进程内 token；主 token 不会传入 Adapter。
const ADAPTER_TOKENS = new Map(ADAPTER_PLATFORMS.map((platform) => [
    platform,
    crypto.createHmac('sha256', BRIDGE_TOKEN).update(`adapter:${platform}`).digest('hex'),
]))
const bridgeAuthRuntime = createBridgeAuthRuntime({
    bridgeHome: BRIDGE_HOME,
    bridgeTokenPath: BRIDGE_TOKEN_PATH,
    bridgeToken: BRIDGE_TOKEN,
    adapterTokens: ADAPTER_TOKENS,
    mkdirSync,
    writeFileSync,
})
const {persistBridgeToken, tokenMatches, authenticateBridgeToken, safeDecodeURIComponent} = bridgeAuthRuntime

// ---- 动态模型/命令缓存 ----
// supportedModels()/supportedCommands() 是控制请求，需活跃 query；冷启动设置页读这里的缓存
// SIDE_EFFECT: mutates dynamicCache（内存）+ 落盘 bridge-dynamic-cache.json
// ---- Session pool ----
const IM_SOURCES = new Set(['wechat', 'feishu', 'dingtalk'])
const MAX_SESSION_INPUT_QUEUE = 32
const sessionRuntime = createSessionRuntimeService({maxPending: MAX_SESSION_INPUT_QUEUE, imSources: IM_SOURCES})
const sessions = sessionRuntime.sessions
const controlClients = new Set()
const getFocusedSessionId = () => sessionRuntime.focusedSessionId
const setFocusedSessionId = value => sessionRuntime.setFocusedSession(value)
const DYNAMIC_CACHE_FILE = join(BRIDGE_HOME, 'bridge-dynamic-cache.json')
const dynamicCacheRuntime = createDynamicCacheRuntime({
    cachePath: DYNAMIC_CACHE_FILE,
    readJSON,
    writeFileSync,
    logger: log,
    sessions,
    getFocusedSessionId,
})
const {dynamicCache, persistDynamicCache, getLiveQuery, withTimeout} = dynamicCacheRuntime
const adapterConfigRuntime = createAdapterConfigRuntime({
    bridgeHome: BRIDGE_HOME,
    adapterConfigPath: ADAPTER_CONFIG_PATH,
    adapterSessionsPath: ADAPTER_SESSIONS_PATH,
    securePayloadKeyPath: SECURE_PAYLOAD_KEY_PATH,
    adapterPlatforms: ADAPTER_PLATFORMS,
    readJSON,
    writeJSON,
    existsSync,
    sessions,
    getFocusedSessionId,
    encodeProjectName,
    normalizeWeChatBaseUrl,
    logger: log,
})
const {
    loadAdapterConfig,
    saveAdapterConfig,
    migrateAdapterCredentials,
    readAdapterBindings,
    writeAdapterBindings,
    listAdapterBindings,
    readAdapterBinding,
    clearAdapterBindings,
    clearAdapterBindingsForSessions,
    isAdapterSessionActive,
    adapterOwnsSession,
    adapterOwnsFocusedSession,
    adapterOwnsProject,
} = adapterConfigRuntime
const taskInputQueue = sessionRuntime.inputQueue
const sessionCoordinator = sessionRuntime.coordinator
const sessionResourceRuntime = createSessionResourceRuntime({sessionCoordinator, withTimeout, logger: log})
const {closeSessionRuntime} = sessionResourceRuntime
const VALID_PERMISSION_MODES = new Set(['default', 'acceptEdits', 'plan', 'bypassPermissions'])
const VALID_THINKING_LEVELS = new Set(['auto', 'off', 'low', 'medium', 'high', 'xhigh', 'max'])
const VALID_MODEL_MODES = new Set(['auto', 'fixed'])
let refreshConfirmationWatchdog = () => {}

// 确认 Runtime 通过惰性依赖连接后续初始化的 IM/广播服务，避免组合根持有确认状态机。
const confirmationRuntime = createConfirmationRuntime({
    sessions,
    getConfirmHooks: () => imRuntime?.confirmHooks || [],
    broadcastTurn: (...args) => broadcastTurn(...args),
    broadcast: (...args) => broadcast(...args),
    broadcastDesktop: (...args) => broadcastDesktop(...args),
    shouldRouteMirror,
    logger: log,
    onSettled: (sessionId, session, _entry, _result, wonBy) => {
        if (!['stopped', 'shutdown', 'delete'].includes(wonBy)) refreshConfirmationWatchdog(sessionId, session)
    },
})
const {settlePending: settlePendingRuntime, makeCanUseTool: makeCanUseToolRuntime,
    decisionToResult: decisionToResultRuntime, labelForChoice: labelForChoiceRuntime} = confirmationRuntime

const pendingQRCodes = new Map()
const UPLOAD_QUOTA_BYTES = 50 * 1024 * 1024
const UPLOAD_TTL_MS = Math.min(30 * 24 * 60 * 60 * 1000, Math.max(5 * 60 * 1000,
    parseInt(process.env.BRIDGE_UPLOAD_TTL_MS || String(24 * 60 * 60 * 1000), 10) || 24 * 60 * 60 * 1000))
const sessionUploadRuntime = createSessionUploadRuntime({
    safeChildPath,
    cleanupUploadDir,
    prepareUploadDir,
    statSync,
    ttlMs: UPLOAD_TTL_MS,
    logger: log,
})
const {
    isValidSessionId,
    isDirectoryPath,
    getUploadDir,
    cleanupSessionUploads,
    prepareSessionUploadDir,
} = sessionUploadRuntime

function markInternalInput(s, taskDecision = null) {
    taskInputQueue.prependInternal(s, {source: s.lastTurnSource || 'desktop', taskDecision})
}
const projectCacheIntegrationRuntime = createProjectCacheIntegrationRuntime({
    loadProjectCache, buildCacheInjectionText, isExplorationAttempt, currentFileScan,
    diffSnapshotVsCurrent, buildProjectCache, saveProjectCache, updateProjectCache,
    markInternalInput, logger: log,
})
const {maybeInjectProjectCache, maybeUpdateProjectCache} = projectCacheIntegrationRuntime

let sdkStreamRuntime = null
let taskCompletionEventRuntime = null
let taskCompletionEffectsRuntime = null
let sessionArtifactRuntime = null
let coordinatorVerificationRuntime = null
let finalReviewRuntime = null
let workflowAutoTriggerRuntime = null
let sessionContextRuntime = null
let projectSessionRuntime = null
let sessionIdentityRuntime = null
const sessionMapPath = (...args) => sessionIdentityRuntime?.sessionMapPath(...args)
const loadSessionMap = (...args) => sessionIdentityRuntime?.loadSessionMap(...args) || {}
const saveSessionMap = (...args) => sessionIdentityRuntime?.saveSessionMap(...args) ?? false
const sessionVisibilityStorePath = (...args) => sessionIdentityRuntime?.sessionVisibilityStorePath(...args)
const saveSessionVisibility = (...args) => sessionIdentityRuntime?.saveSessionVisibility(...args) ?? false
const markVisibleSession = (...args) => sessionIdentityRuntime?.markVisibleSession(...args) ?? false
const removeVisibleSession = (...args) => sessionIdentityRuntime?.removeVisibleSession(...args) ?? false
const removeVisibleSessionEverywhere = (...args) => sessionIdentityRuntime?.removeVisibleSessionEverywhere(...args)
const getProjectVisibility = (...args) => sessionIdentityRuntime?.getProjectVisibility(...args) || {version: 1, sessions: {}}
const persistSdkSessionId = (...args) => sessionIdentityRuntime?.persistSdkSessionId(...args) ?? false
const removeSdkSessionId = (...args) => sessionIdentityRuntime?.removeSdkSessionId(...args) ?? false
const lookupSdkSessionId = (...args) => sessionIdentityRuntime?.lookupSdkSessionId(...args) || null
const lookupGatewaySessionId = (...args) => sessionIdentityRuntime?.lookupGatewaySessionId(...args) || null
const startStreamPump = (...args) => {
    if (!sdkStreamRuntime) throw new Error('SDK Stream Runtime 尚未初始化')
    return sdkStreamRuntime.startStreamPump(...args)
}
const taskCompletionEventForClient = (...args) => {
    if (!taskCompletionEventRuntime) throw new Error('Task Completion Event Runtime 尚未初始化')
    return taskCompletionEventRuntime.taskCompletionEventForClient(...args)
}
const publishVerificationInconclusive = (...args) => {
    if (!taskCompletionEventRuntime) throw new Error('Task Completion Event Runtime 尚未初始化')
    return taskCompletionEventRuntime.publishVerificationInconclusive(...args)
}
const applyTaskCompletionEffects = (...args) => {
    if (!taskCompletionEffectsRuntime) throw new Error('Task Completion Effects Runtime 尚未初始化')
    return taskCompletionEffectsRuntime.applyTaskCompletionEffects(...args)
}
const beginTurn = (...args) => sessionArtifactRuntime?.beginTurn(...args)
const finalizeCheckpoint = (...args) => sessionArtifactRuntime?.finalizeCheckpoint(...args)
const rewindToCheckpoint = (...args) => sessionArtifactRuntime?.rewindToCheckpoint(...args)
const saveSnapshot = (...args) => sessionArtifactRuntime?.saveSnapshot(...args)
const loadSnapshot = (...args) => sessionArtifactRuntime?.loadSnapshot(...args)
const loadCheckpoints = (...args) => sessionArtifactRuntime?.loadCheckpoints(...args) || []
const saveCheckpoints = (...args) => sessionArtifactRuntime?.saveCheckpoints(...args) ?? false
const runCoordinatorValidation = (...args) => coordinatorVerificationRuntime?.runCoordinatorValidation(...args)
const autoTriggerFinalReview = (...args) => finalReviewRuntime?.autoTriggerFinalReview(...args)
const autoTriggerWorkflow = (...args) => workflowAutoTriggerRuntime?.autoTriggerWorkflow(...args)
const resolveSdkInputContent = (...args) => {
    if (!sessionContextRuntime) throw new Error('Session Context Runtime 尚未初始化')
    return sessionContextRuntime.resolveSdkInputContent(...args)
}
const taskLifecycleRuntime = createTaskLifecycleRuntime({
    sessions,
    createTaskStatePatch,
    saveTaskState,
    appendSessionEvent,
    journalTaskState,
    persistTaskStateProjection,
    createTaskCompletionState,
    taskStateForError,
    taskStateForStop,
    resolveTaskPhases,
    buildProjectContext: loadOrBuildProjectContext,
    resolveTaskAgents,
    createTaskPlan,
    getTaskWorkbench: () => taskWorkbench,
    getTaskCoordinator: () => taskCoordinator,
    resolveRequiredNotificationPlatforms,
    transitionTaskCompletion,
    getSessionWorkflowStates,
    getSessionRuntimeState,
    hasPendingTaskWorkflow,
    getTaskStateForSessionClient: () => taskStateForSessionClient,
    createTaskLifecycleSnapshot,
    getBroadcastDesktop: () => broadcastDesktop,
    logger: log,
})
const {
    updateTaskState,
    taskStateFromCompletion,
    updateTaskNotificationState,
    initializeTaskWorkbenchSession,
    buildTaskPitfallReminder,
    requestCoordinatorCompletion,
    getWaitingCoordinatorTask,
    resumeWaitingCoordinatorTask,
    requiredTaskNotificationPlatforms,
    taskStateWithNotificationIntents,
    updateTaskCompletion,
    getTaskLifecycleSnapshot,
    broadcastTaskLifecycle,
} = taskLifecycleRuntime
const sessionInputRuntime = createSessionInputRuntime({
    taskInputQueue,
    createTurnIdentity,
    selectCancelledTurnInputs: selectCancelledInputTurns,
    getBroadcastTurn: () => broadcastTurn,
    sessions,
    sessionCoordinator,
    streamHeartbeatIntervalMs: 15 * 1000,
    getStreamTimeoutConfig: () => normalizeStreamWatchdogConfig(loadCliSettings().streamWatchdog),
    updateTaskCompletion,
    updateTaskState,
    applyTaskCompletionEffects,
    taskStateForError,
    updateTaskState,
    appendSessionEvent,
    getTaskStateForClient: () => taskStateForClient,
    broadcastTaskLifecycle,
    logger: log,
    imSources: IM_SOURCES,
})
const {
    acceptSessionInput,
    rollbackSessionInput,
    failPendingSessionInputs,
    cancelPendingSessionInputs,
    clearStreamWatchdog,
    armStreamWatchdog,
} = sessionInputRuntime
refreshConfirmationWatchdog = (sessionId, session) => {
    if (session?._generating && session.query) armStreamWatchdog(sessionId, session, session.query)
}
const sessionStopRuntime = createSessionStopRuntime({
    sessions,
    getSessionWorkflowStates,
    hasStoppableSessionWork,
    clearStreamWatchdog,
    getSessionStopScope,
    stopWorkflow,
    broadcastTaskLifecycle,
    resolvePrimaryStopTurnId,
    updateTaskCompletion,
    getTaskWorkbench: () => taskWorkbench,
    clearTaskWorkflowGate,
    sessionCoordinator,
    settlePending: settlePendingRuntime,
    closeSessionRuntime,
    finalizeCheckpoint,
    cancelPendingSessionInputs,
    taskStateForStop,
    updateTaskState,
    appendSessionEvent,
    getBroadcastTurn: () => broadcastTurn,
    getTaskStateForClient: () => taskStateForClient,
    logger: log,
})
const {stopSessionGeneration} = sessionStopRuntime

sessionContextRuntime = createSessionContextRuntime({
    bridgeHome: BRIDGE_HOME,
    listProjectTranscriptCandidates,
    buildProjectContinuationContext,
    composeContinuationPrompt,
    userPreferences,
    memoryService: () => memoryService,
    encodeProjectName,
    sessionRepository: () => stateRepositories()?.session,
    contextPlanner: createContextPlanner({logger: log}),
    logger: log,
})

const taskCommandRuntime = createTaskCommandRuntime({
    sessions, taskInputQueue, sessionCoordinator, IM_SOURCES, log, loadCliSettings, VALID_MODEL_MODES,
    MODEL, decideTask, resolveTurnModelRoute, loadWfConfig, validateProviderModel,
    acceptSessionInput, rollbackSessionInput, appendSessionEvent, markVisibleSession,
    isUserSessionSource, getBroadcastDesktop: () => broadcastDesktop, createTaskCompletionState, createTurnIdentity,
    createTaskWorkflowGate, initializeTaskWorkbenchSession, getWaitingCoordinatorTask, resumeWaitingCoordinatorTask, userPreferences, updateTaskState,
    taskCompletionEventForClient, getBroadcast: () => broadcast, resolveSdkInputContent, buildTaskPitfallReminder,
    routeSkills, createSessionContextEnvelope, resolveContextReusePolicy,
    resolveProviderCapabilityProfile, buildModelHandoffPrompt, beginTurn,
    shouldCaptureTurnCheckpoint, closeSessionRuntime, startClaudeAgent, PushStream,
    loadAgentDefinitions, getMakeQueryOptions: () => makeQueryOptions, getStartStreamPump: () => startStreamPump, failPendingSessionInputs,
    updateTaskCompletion, broadcastTaskLifecycle, clearStreamWatchdog, armStreamWatchdog,
    autoTriggerWorkflow,
    persistTaskEvent: (session, event) => {
        const repository = stateRepositories()?.workbench
        if (!repository?.appendTaskEvent || !session?.workDir || !event?.eventPayload?.taskId) return false
        return repository.appendTaskEvent({
            projectKey: sessionCatalogProjectKey(session.workDir),
            taskKey: event.eventPayload.taskId,
            eventRevision: event.eventRevision,
            eventType: event.eventType,
            eventPayload: event.eventPayload,
            createdAt: event.createdAt,
        })
    },
})
// Workflow 运行端口必须在所有 Coordinator/Task Runtime 消费者创建前建立。
// 端口内部延迟读取实例，允许组合根稍后完成 Workflow Runtime 初始化，同时避免模块求值阶段触发 TDZ。
let workflowRuntime = null
const runWorkflowPort = (...args) => workflowRuntime?.runWorkflow(...args) ?? runWfScript(...args)

const taskCommands = createTaskCommandService({
    submit: taskCommandRuntime.submitTaskCommand,
    cancel: async sessionId => {
        const session = sessions.get(sessionId)
        if (!session) return {stopped: false, code: 'session_not_found'}
        return stopSessionGeneration(sessionId, session)
    },
    onListenerError: (error, context) => {
        log.warn({err: error, sessionId: context.sessionId?.slice(0, 8), eventType: context.eventType}, 'Task observer 处理失败')
    },
})

const coordinatorPersistence = createCoordinatorPersistence({
    repository: () => stateRepositories()?.workbench,
    projectKeyForWorkDir: sessionCatalogProjectKey,
    resolveJournal: sessionId => sessions.get(sessionId)?.eventJournal || null,
})

taskCoordinator = createTaskCoordinator({
    persist: coordinatorPersistence,
    publish: (snapshot, event) => {
        if (!snapshot?.sessionId) return
        const payload = {
            type: 'task_coordinator_event',
            taskId: snapshot.taskId,
            turnId: snapshot.turnId,
            status: snapshot.status,
            phase: snapshot.phase,
            revision: snapshot.revision,
            sequence: snapshot.sequence,
            event: event?.type || 'task/state-changed',
            stepId: event?.stepId || null,
            role: event?.role || null,
            detail: event?.detail || null,
            verification: snapshot.verification,
            timestamp: snapshot.updatedAt,
        }
        const identity = {source: snapshot.source, userId: snapshot.userId || null}
        broadcastTurn(snapshot.sessionId, payload, identity)
    },
})
const coordinatorRcaRuntime = createCoordinatorRcaRuntime({
    getTaskWorkbench: () => taskWorkbench,
    taskCoordinator,
    listWorkflows,
    presetRunState,
    runWorkflow: runWorkflowPort,
    loadWorkflowConfig: loadWfConfig,
    logger: log,
})
const {runCoordinatorRootCauseAnalysis} = coordinatorRcaRuntime

// 活跃 Session 的附件目录定期回收；非活跃 Session 会在删除或下次上传时回收。
setInterval(() => {
    for (const [sessionId, s] of sessions) cleanupSessionUploads(s.workDir, sessionId)
}, 15 * 60 * 1000).unref()
// 每 60s 清理过期二维码（5 分钟有效期，保守清理）
setInterval(() => {
    const now = Date.now()
    for (const [pid, entry] of pendingQRCodes) {
        if (now > entry.expires) pendingQRCodes.delete(pid)
    }
}, 60_000).unref()

const imRuntime = createImRuntime({
    sessions, IM_SOURCES, ADAPTER_TOKENS, taskCommands,
    ADAPTER_STARTERS: new Map([
        ['wechat', startWeChatAdapter], ['feishu', startFeishuAdapter], ['dingtalk', startDingTalkAdapter],
    ]),
    getNotificationRepository: () => stateRepositories()?.notification,
    resolveSessionLink: ({task, projectKey}) => resolveSessionLink({
        task, projectKey,
        lookupGatewaySessionId: (owner, sdkSessionId) => lookupGatewaySessionId(owner, sdkSessionId),
        lookupSdkSessionId: (owner, gatewaySessionId) => lookupSdkSessionId(owner, gatewaySessionId),
        findTranscript: ({projectKey: owner, sessionId}) => findSessionTranscript({bridgeHome: BRIDGE_HOME, encodedDir: owner, sessionId}),
    }),
    getSessionRepository: () => stateRepositories()?.session,
    getImRepository: () => stateRepositories()?.im,
    updateTaskNotificationState, loadTaskState,
    buildIncompleteMirrorText, shouldRouteMirror, stateRepositories,
    clearAdapterBindings, BRIDGE_HOME, join, existsSync, unlinkSync, log,
    createImProgressPolicy, createImProgressReporter, taskStateForClient,
})
const {confirmHooks, imProgressReporters, getAdapterHook, handleNotificationStateChange,
    reconcilePersistedNotificationIntents, imProgressRecipients, finishImProgressReporters,
    reportImProgressEvent, taskStateForSessionClient, stopAdapter, startAdapter, restartAdapter,
    clearAdapterPlatformState, maybeMirror, reconcileTaskNotificationIntents} = imRuntime
const sessionBroadcastRuntime = createSessionBroadcastRuntime({
    sessions,
    getTaskCommands: () => taskCommands,
    reportImProgressEvent,
    shouldDeliverTurnEvent,
    logger: log,
})
const {broadcast, broadcastTurn, broadcastDesktop} = sessionBroadcastRuntime
taskCompletionEventRuntime = createTaskCompletionEventRuntime({
    taskStateForInconclusive,
    taskStateFromCompletion,
    taskStateWithNotificationIntents,
    taskStateForSessionClient,
    updateTaskState,
    broadcastTurn,
    broadcastTaskLifecycle,
    maybeMirror,
    logger: log,
})
finalReviewRuntime = createFinalReviewRuntime({
    sessions,
    loadWfConfig,
    updateTaskCompletion,
    applyTaskCompletionEffects,
    resolveFinalReviewPlan,
    listWorkflows,
    presetRunState,
    broadcastTaskLifecycle,
    broadcast,
    runWfScript: runWorkflowPort,
    normalizeReviewOutcome,
    taskCoordinator,
    taskWorkbench,
    getTaskWorkbench: () => taskWorkbench,
    logger: log,
})
workflowAutoTriggerRuntime = createWorkflowAutoTriggerRuntime({
    loadWfConfig,
    shouldAutoTriggerWorkflow,
    classifyContextProfile,
    listWorkflows,
    presetRunState,
    sessions,
    createTaskWorkflowGate,
    attachTaskWorkflow,
    broadcastTaskLifecycle,
    logger: log,
    broadcast,
    resolveWorkflowFinalReviewTier,
    runWfScript: runWorkflowPort,
})
taskCompletionEffectsRuntime = createTaskCompletionEffectsRuntime({
    sessions,
    runCoordinatorValidation,
    taskWorkbench,
    getTaskWorkbench: () => taskWorkbench,
    taskCompletionEventForClient,
    publishVerificationInconclusive,
    autoTriggerFinalReview,
    runCoordinatorRootCauseAnalysis,
    updateTaskCompletion,
    beginTurn,
    markInternalInput,
    hasPersistedNotificationIntents,
    requiredTaskNotificationPlatforms,
    requestCoordinatorCompletion,
    updateTaskState,
    taskStateFromCompletion,
    maybeMirror,
    taskCoordinator,
    log,
    captureAutomaticMemory: memoryAutoCaptureRuntime.captureAutomaticMemory,
})
sessionArtifactRuntime = createSessionArtifactRuntime({
    BRIDGE_HOME,
    encodeProjectName,
    readJSON,
    writeJSON,
    log,
    sessions,
    buildFileSnapshot,
    currentFileScan,
    diffSnapshotVsCurrent,
    resolveSafe,
    existsSync,
    unlinkSync,
    dirname,
    join,
    mkdirSync,
    writeFileSync,
})
// ── WebSocket 广播 ──
// 功能说明: 向指定 session 的所有已连接 WebSocket 客户端广播一条 JSON 消息
//   这是桌面端实时更新的核心通道：所有 SDK 输出/确认请求都通过此函数推给 UI
// 实现方式: 从 sessions Map 取 session → 遍历 s.clients Set → 对 readyState===1（OPEN）的客户端 send JSON 字符串
//   JSON.stringify 只执行一次（提前序列化），避免重复序列化
const workflowBroadcastRuntime = createWorkflowBroadcastRuntime({
    sessions,
    getRunState,
    getTaskCoordinator: () => taskCoordinator,
    getTaskWorkbench: () => taskWorkbench,
    createTaskWorkflowGate,
    attachTaskWorkflow,
    noteTaskWorkflowTerminal,
    takeDeferredPrimaryResult,
    updateTaskCompletion,
    updateTaskState,
    applyTaskCompletionEffects,
    taskCompletionEventForClient,
    appendSessionEvent,
    reportImProgressEvent,
    broadcast,
    broadcastTaskLifecycle,
    logger: log,
})
const {broadcastWorkflowEvent} = workflowBroadcastRuntime

const toolingUpdateRuntime = createToolingUpdateRuntime({
    BRIDGE_HOME, __dirname, dynamicCache, persistDynamicCache, loadCliSettingsForUpdate,
    readJSON, writeJSON, existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync,
    renameSync, resolve, join, dirname, homedir, spawn, spawnSync, statSync,
    resolveRtkCommandArgs, selectRtkReleaseAsset, verifyRtkAssetDigest,
    buildWindowsRtkExtractArgs, buildWindowsRtkExtractEnv, logger: log,
})
const toolingUpdate = toolingUpdateRuntime
const {
    CAVEMAN_SKILL_DIR, CAVEMAN_SKILL_FILE, CAVEMAN_DEFAULT_CONFIG, CAVEMAN_VALID_LEVELS,
    CAVEMAN_VERSION_FILE, RTK_TIMEOUT, RTK_REJECT_RATIO, RTK_CRITICAL_PATTERN,
    MAX_RTK_ARCHIVE_BYTES, MAX_REMOTE_TEXT_BYTES, RTK_READONLY_CROSS, RTK_READONLY_UNIX,
    RTK_READONLY_PREFIXES, extractSemver, compareSemver, checkCavemanUpdate,
    downloadAndReplaceCaveman, loadCavemanConfig, saveCavemanConfig, buildCavemanSystemPrompt,
    readFetchBodyLimited, locateRtk, getRtkDir, loadRtkConfig, saveRtkConfig, checkRtkUpdate,
    downloadAndReplaceRtk, rtkPostToolUseHandler, parseShellArgs, isReadOnlyCommand,
    findGitBashDirs, spawnRtk,
} = toolingUpdate
const {makeQueryOptions} = createQueryOptionsRuntime({
    BRIDGE_HOME, MODEL, VALID_PERMISSION_MODES, VALID_THINKING_LEVELS, VALID_MODEL_MODES,
    restoreSecretValue, getClaudeExe, normalizeContextProfile, routeSkills, loadOrBuildProjectContext,
    getBuiltinResourceState, ensureBuiltinSkillsAvailable, decideTask, loadAgentDefinitions,
    shouldDeferAutomaticQuery, mapModel, resolveTaskModelRoute, loadWfConfig,
    shouldValidateProviderModel, validateProviderModel, prepareQueryProvider,
    parseTokenCount, lookupModelInfo, calculateAutoCompactWindow, mapThinkingLevel,
    sanitizeMcpServers, buildChildProcessEnv, buildCavemanSystemPrompt,
    makeCanUseTool: makeCanUseToolRuntime, rtkPostToolUseHandler, applyContextProfile, applySkillRoute,
    relative, resolve, basename, dirname, join, rmdirSync, safeChildPath,
    existsSync, unlinkSync, deleteSession, sessions, broadcast, log,
})

workflowRuntime = createWorkflowRuntime({agentProvider: claudeAgentProvider, deleteSession, makeQueryOptions, loadCliSettings, loadWfConfig,
    PushStream, broadcast: broadcastWorkflowEvent, sessions, persistSdkSessionId, removeSdkSessionId,
    encodeProjectName, workflowRepository: () => stateRepositories()?.workflow,
    getAgentRegistry: (decision, projectContext) => createRuntimeAgentRegistry(decision, projectContext),
    getAgentMailbox: () => agentMailbox,
})

const hookValidationRuntime = createHookValidationRuntime({bridgeHome: BRIDGE_HOME, joinPath: join, basename, readJSON, safeBasename, exists: existsSync, logger: log})
const {validateHooks} = hookValidationRuntime
const weChatChunkRuntime = createWeChatChunkRuntime()
const {splitByBytes: splitWeChatByBytes, sendWeChatChunks: sendWeChatChunksRuntime} = weChatChunkRuntime

const splitByBytes = splitWeChatByBytes
const sendWeChatChunks = sendWeChatChunksRuntime

// 多平台镜像：遍历所有适配器，mirror 已开启的才推（各适配器自行实现 sendToUser/findUserForSession）
// 功能说明: 检测到 Claude 正在探索项目结构时（Glob/Grep/Agent Explore/Bash find），
//   如果存在项目缓存则注入摘要到 pushStream，避免重复探索
//   每 session 只注入一次（_cacheInjected 标记）
// 实现方式: isExplorationAttempt 判定 → loadProjectCache 读缓存 → pushStream.push 注入
const projectGitRuntime = createProjectGitRuntime({execSync, markInternalInput, logger: log})
const buildGitContext = projectGitRuntime.buildGitContext
const maybeInjectGitContext = projectGitRuntime.injectGitContext

// Claude Code 内置命令兜底列表（冷启动无活跃 query 时用，无需等 SDK 连接）
const BUILTIN_COMMANDS = [
    {name: 'help', description: '获取帮助信息', argumentHint: ''},
    {name: 'clear', description: '清除对话历史', argumentHint: ''},
    {name: 'compact', description: '压缩上下文释放 token', argumentHint: ''},
    {name: 'config', description: '打开配置面板', argumentHint: ''},
    {name: 'cost', description: '查看当前会话 token 消耗', argumentHint: ''},
    {name: 'doctor', description: '诊断环境问题', argumentHint: ''},
    {name: 'init', description: '初始化项目 CLAUDE.md', argumentHint: ''},
    {name: 'review', description: '代码审查当前变更', argumentHint: ''},
    {name: 'simplify', description: '简化/重构当前代码', argumentHint: ''},
    {name: 'agents', description: '管理自定义子代理', argumentHint: ''},
    {name: 'memory', description: '管理项目记忆', argumentHint: ''},
    {name: 'permissions', description: '管理权限设置', argumentHint: ''},
    {name: 'hooks', description: '管理事件钩子', argumentHint: ''},
    {name: 'mcp', description: '管理 MCP 服务器', argumentHint: ''},
    {name: 'fast', description: '切换快速模式', argumentHint: ''},
    {name: 'context', description: '查看当前上下文信息', argumentHint: ''},
    {name: 'status', description: '查看会话状态', argumentHint: ''},
    {name: 'security-review', description: '安全审查代码', argumentHint: ''},
    {name: 'terminal-setup', description: '终端设置引导', argumentHint: ''},
    {name: 'basilica', description: 'Basilica 模式', argumentHint: ''},
]

// IM 自定义命令（微信/飞书/钉钉通用，显示在设置页"命令"Tab 自定义分组）
const IM_CUSTOM_COMMANDS = [
    {name: 'p', description: '列出所有已注册项目', argumentHint: '', aliases: ['projects', '项目']},
    {name: 'ss', description: '列出项目下所有Session', argumentHint: '[项目]', aliases: ['sessions', '会话']},
    {name: 'sw', description: '切换项目并同步桌面', argumentHint: '<项目> [编号]', aliases: ['switch', '切换']},
    {name: 'sws', description: '当前项目下切换会话', argumentHint: '<编号>', aliases: ['switch-session', '切换会话']},
    {name: 'ns', description: '新建会话并同步桌面', argumentHint: '[项目]', aliases: ['新会话']},
    {name: 'm', description: '开启/关闭平台镜像同步', argumentHint: '<微信/飞书/钉钉> [on/off]', aliases: ['mirror', '镜像']},
    {name: 'stop', description: '停止当前正在运行的 agent', argumentHint: '', aliases: ['停止']},
    {name: 'i', description: '当前项目/Session/桌面状态', argumentHint: '', aliases: ['info', '信息']},
    {name: 'h', description: '列出所有可用命令', argumentHint: '', aliases: ['help', '帮助']},
]

// SDK 内置 Skills 兜底列表（冷启动无活跃 session 时用）
const BUILTIN_SKILLS = [
    'avalonia-ui', 'db-sql', 'device-driver', 'embedded-c', 'project-router',
    'protocol-parser', 'spring-boot-api', 'ui-design', 'ui-winforms',
    'uniapp-android', 'vue-frontend', 'wechat-wait',
    'deep-research',
    'anthropic-skills:consolidate-memory', 'anthropic-skills:schedule', 'anthropic-skills:setup-cowork',
    'update-config', 'keybindings-help', 'verify',
    'code-review', 'simplify', 'fewer-permission-prompts',
    'loop', 'claude-api', 'run', 'init', 'review', 'security-review',
    'caveman',
]

// SDK 内置 Agents 兜底列表
const BUILTIN_AGENTS = [
    'claude', 'claude-code-guide', 'Explore', 'general-purpose', 'Plan', 'statusline-setup',
]
// 内置 agent 类型分类（SDK 内置无 .md 文件，手动打 type 标签）
const BUILTIN_AGENT_TYPES = {
    'claude': 'general',
    'claude-code-guide': 'guide',
    'Explore': 'explorer',
    'general-purpose': 'general',
    'Plan': 'planner',
    'statusline-setup': 'builder',
}

// SDK 内置 MCP 兜底列表（key: name → {version, scope}）
const BUILTIN_MCP = {
    'ccd_directory': {version: 'builtin', scope: 'builtin'},
    'ccd_session': {version: 'builtin', scope: 'builtin'},
    'ccd_session_mgmt': {version: 'builtin', scope: 'builtin'},
    'Claude_Preview': {version: 'builtin', scope: 'builtin'},
    'scheduled-tasks': {version: 'builtin', scope: 'builtin'},
}

// ---- 内置项缓存（SDK system_init 暴露的 skills/agents/commands 名单）----
// 冷启动时用硬编码兜底列表初始化，SDK 连接后由 system_init 合并更新
const builtinCache = {skills: [...BUILTIN_SKILLS], agents: [...BUILTIN_AGENTS], commands: [], updatedAt: 0}
const resourceConfigRoutes = createResourceConfigRoutes({
    bridgeHome: BRIDGE_HOME,
    parseFrontmatter,
    builtinCache,
    safeDecodeURIComponent,
    backupFile,
    loadCliSettingsForUpdate,
    readJSON,
    log,
    readBody,
    dynamicCache,
    readFetchBodyLimited,
    maxRemoteTextBytes: MAX_REMOTE_TEXT_BYTES,
    cavemanValidLevels: CAVEMAN_VALID_LEVELS,
    loadCavemanConfig,
    saveCavemanConfig,
    downloadAndReplaceCaveman,
    loadRtkConfig,
    locateRtk,
    saveRtkConfig,
    downloadAndReplaceRtk,
    builtinAgentTypes: BUILTIN_AGENT_TYPES,
    getLiveQuery,
    withTimeout,
    persistDynamicCache,
    builtinCommands: BUILTIN_COMMANDS,
    imCustomCommands: IM_CUSTOM_COMMANDS,
    loadWfConfig,
    saveWfConfig,
})
const configRoutes = createConfigRoutes({
    bridgeHome: BRIDGE_HOME,
    version: PKG_VERSION,
    readJSON,
    writeJSON,
    backupFile,
    loadBridgeProviderSettings,
    saveBridgeProviderSettings,
    overlayBridgeProviderSettings,
    extractBridgeProviderSettings,
    stripBridgeProviderSettings,
    redactSecretMap,
    restoreSecretMap,
    getClaudeExe,
    loadCliSettingsForUpdate,
    setClaudeExe,
    existsSync,
    readBody,
    log,
})

// ── 定时任务调度（模块级状态）──
const SCHEDULED_TASKS_FILE = join(BRIDGE_HOME, 'bridge-scheduled-tasks.json')
const scheduledTaskStore = createScheduledTaskStore({readJSON, writeJSON, path: SCHEDULED_TASKS_FILE})
const cronJobs = new Map()
const scheduledRuns = new Map()
const MAX_SCHEDULED_CONCURRENT = Math.min(8, Math.max(1, parseInt(process.env.BRIDGE_SCHEDULED_MAX_CONCURRENT || '2', 10) || 2))
const MAX_SCHEDULED_DURATION_MS = Math.min(24 * 60 * 60 * 1000, Math.max(60_000,
    parseInt(process.env.BRIDGE_SCHEDULED_MAX_DURATION_MS || String(30 * 60 * 1000), 10) || 30 * 60 * 1000))
const MAX_OCR_CONCURRENT = Math.min(4, Math.max(1, parseInt(process.env.BRIDGE_OCR_MAX_CONCURRENT || '1', 10) || 1))
let activeOcr = 0

/* Workflow Auto Trigger Runtime 在 Workflow 依赖初始化后接线。 */

// ---- HTTP server 组合接线 ----
let handleHttpRequest

/* Final Review Runtime 在 Workflow 依赖初始化后接线。 */
const sdkStreamAdapter = createSdkStreamAdapter({
    getSession: sessionId => sessions.get(sessionId) || null,
    lookupModelInfo,
    buildSystemInitEvent,
    buildAgentDescriptor,
    compactBoundaryToEvent,
    isSyntheticCompactSummary,
    isInternalWorkflowResultText,
    isAutoContinuationPrompt,
    classifyTaskResult,
    canResumeTask,
})
const sdkStreamRuntimeDependencies = {
    sessions,
    getStateStore: () => bridgeStateDb,
    log,
    updateTaskCompletion,
    applyTaskCompletionEffects,
    broadcastTurn,
    taskStateForClient,
    taskStateForError,
    updateTaskState,
    failPendingSessionInputs,
    appendSessionEvent,
    persistSessionMirrors,
    persistSdkSessionId,
    sessionVisibilitySource,
    getProjectVisibility,
    markVisibleSession,
    broadcastDesktop,
    dynamicCache,
    builtinCache,
    persistDynamicCache,
    taskWorkflowResultIdFromMessage,
    consumeTaskWorkflowResultTurn,
    taskInputQueue,
    IM_SOURCES,
    createTurnIdentity,
    loadWfConfig,
    getWorkflow,
    runWfScript: runWorkflowPort,
    finishTaskWorkflowResultTurn,
    hasPendingTaskWorkflow,
    consumePendingSessionInputOnResult,
    sdkStreamAdapter,
    broadcastTaskLifecycle,
    classifyTaskResult,
    resolveAutoContinuation,
    maybeUpdateProjectCache,
    finalizeCheckpoint,
    resolveFinalReviewPlan,
    canResumeTask,
    deferPrimaryResultForTaskWorkflow,
    takeDeferredPrimaryResult,
    taskCompletionEventForClient,
    taskWorkbench,
    getTaskWorkbench: () => taskWorkbench,
    taskCoordinator,
    maybeInjectProjectCache,
    maybeInjectGitContext,
    clearTaskWorkflowGate,
    clearStreamWatchdog,
    markSessionDeleted,
    finishImProgressReporters,
    clearAdapterBindingsForSessions,
    invalidateProjectsCache,
    deleteSessionFiles,
    armStreamWatchdog,
    getFocusedSessionId,
    setFocusedSessionId,
    withTimeout,
        getSessionRepository: () => stateRepositories()?.session,
    getSessionProjectKey: sessionCatalogProjectKey,
}
sdkStreamRuntime = createSdkStreamRuntime(sdkStreamRuntimeDependencies)

const httpServer = createServer((req, res) => {
    void handleHttpRequest(req, res).catch(error => {
        log.error({err: error, method: req.method, url: String(req.url || '').slice(0, 512)}, 'HTTP 请求处理异常')
        if (!res.headersSent) {
            res.setHeader('Content-Type', 'application/json')
            res.writeHead(500)
            res.end(JSON.stringify({error: 'internal server error'}))
            return
        }
        res.destroy(error)
    })
})
httpServer.headersTimeout = 10_000
httpServer.requestTimeout = 30_000
httpServer.keepAliveTimeout = 5_000
httpServer.maxRequestsPerSocket = 1_000

const wss = new WebSocketServer({noServer: true, maxPayload: 1048576})
const websocketGateway = createWebSocketGateway({
    httpServer,
    wss,
    port: PORT,
    authenticate: authenticateBridgeToken,
    extractToken: extractWebSocketToken,
    imSources: IM_SOURCES,
    logger: log,
})
const rejectWebSocketUpgrade = websocketGateway.reject
createWebSocketSessionRuntime({
    wss, controlClients, sessions, IM_SOURCES, safeDecodeURIComponent,
    adapterOwnsSession, getFocusedSessionId,
    setFocusedSessionId,
    getSessionRuntimeState, taskStateForSessionClient, getTaskLifecycleSnapshot,
    userPreferences, getSessionWorkflowState, getSessionWorkflowStates, taskCommands, VALID_PERMISSION_MODES,
    updateTaskState, persistSessionCatalogSettings, settlePending: settlePendingRuntime, decisionToResult: decisionToResultRuntime,
    broadcastDesktop, log,
})
// WS 心跳: 每 30s ping 一次，60s 无 pong 则断开死连接
const WS_PING_INTERVAL = 30_000
const WS_PING_TIMEOUT = 60_000
const wsPingTimer = setInterval(() => {
    for (const ws of wss.clients) {
        if (ws.readyState !== 1) continue
        if (!ws._lastPong) ws._lastPong = Date.now()
        if (Date.now() - ws._lastPong > WS_PING_TIMEOUT) {
            ws.terminate()
            continue
        }
        ws.ping()
    }
    // 同时清理控制通道死连接
    for (const ws of controlClients) {
        if (ws.readyState !== 1) { controlClients.delete(ws); continue }
        if (!ws._lastPong) ws._lastPong = Date.now()
        if (Date.now() - ws._lastPong > WS_PING_TIMEOUT) {
            ws.terminate()
            controlClients.delete(ws)
        }
    }
}, WS_PING_INTERVAL)

// ---- Start ----
const scheduledRuntime = createScheduledRuntime({
    cron, scheduledTaskStore, sessions, cronJobs, scheduledRuns,
    MAX_SCHEDULED_CONCURRENT, MAX_SCHEDULED_DURATION_MS, log, isDirectoryPath,
    decideTask, MODEL, crypto, PushStream, loadCliSettings, makeQueryOptions,
    openSessionEventJournal, startClaudeAgent, createSessionRuntime,
    createTaskCompletionState, appendSessionEvent, initializeTaskWorkbenchSession,
    updateTaskState, taskStateFromCompletion, markInternalInput,
    buildTaskPitfallReminder, startStreamPump, stopSessionGeneration,
})
const destroyScheduledJob = scheduledRuntime.destroyScheduledJob
const registerScheduledJob = scheduledRuntime.registerScheduledJob
const executeScheduledTask = scheduledRuntime.executeScheduledTask
const resumeScheduledTasks = scheduledRuntime.resumeScheduledTasks
const finishScheduledRun = scheduledRuntime.finishScheduledRun
let shuttingDown = false
const shutdownRuntime = createShutdownRuntime({
    logger: log,
    getShuttingDown: () => shuttingDown,
    setShuttingDown: value => { shuttingDown = value },
    adapters: ADAPTER_PLATFORMS,
    stopAdapter,
    cronJobs,
    destroyScheduledJob,
    scheduledRuns,
    finishScheduledRun,
    stopSessionGeneration,
    wsPingTimer,
    wss,
    sessions,
    finishImProgressReporters,
    settlePending: settlePendingRuntime,
    appendSessionEvent,
    taskCommands,
    providerRegistry,
    stopProxies: providerRuntime.stopProxies(),
    getStateDb: () => bridgeStateDb,
    getStorageGateway: () => storageGateway,
    httpServer,
})
const shutdownGateway = shutdownRuntime.shutdown
const requestGatewayShutdown = shutdownRuntime.request
const securePayloadRuntime = createSecurePayloadRuntime({
    configureSecurePayloadMasterKey,
    logger: log,
})
const {initializeSecurePayloadKey} = securePayloadRuntime

process.on('uncaughtException', (e) => {
    log.fatal({err: e}, 'uncaughtException')
    requestGatewayShutdown('uncaughtException', 1)
})
process.on('unhandledRejection', (reason) => {
    log.fatal({err: reason}, 'unhandledRejection')
    requestGatewayShutdown('unhandledRejection', 1)
})
process.once('SIGINT', () => requestGatewayShutdown('SIGINT'))
process.once('SIGTERM', () => requestGatewayShutdown('SIGTERM'))
process.on('message', message => {
    if (message?.type === 'shutdown') requestGatewayShutdown('ipc')
})

const startupRuntime = createStartupRuntime({
    bridgeHome: BRIDGE_HOME,
    prepareBridgeHome,
    readStorageConfigFile,
    createStorageGateway,
    ensurePostgresSchema,
    createPostgresStateCompat,
    createPitfallService,
    createPitfallAdmin,
    createTaskWorkbenchRuntime,
    createCoordinatorVerificationRuntime,
    createMemoryService,
    createAgentMailbox,
    createMemoryCandidateStore,
    createVerificationAdapterRegistry,
    createCommandVerificationAdapter,
    createVerificationCampaignService,
    sessionCatalogProjectKey,
    appendSessionEvent,
    stateStore: {
        get taskCoordinator() { return taskCoordinator },
        get pitfallService() { return pitfallService },
    },
    getRepositories: stateRepositories,
    setState: value => { bridgeStateDb = value },
    setStorage: value => { storageGateway = value },
    setTaskWorkbench: value => { taskWorkbench = value },
    setCoordinatorVerification: value => { coordinatorVerificationRuntime = value },
    setMemoryService: value => { memoryService = value },
    setAgentMailbox: value => { agentMailbox = value },
    setMemoryCandidateStore: value => { memoryCandidateStore = value },
    setPitfallService: value => { pitfallService = value },
    initializeSecurePayloadKey,
    migrateAdapterCredentials,
    validateHooks,
    httpServer,
    port: PORT,
    requestGatewayShutdown,
    persistBridgeToken,
    bridgeTokenPath: BRIDGE_TOKEN_PATH,
    adapterPlatforms: ADAPTER_PLATFORMS,
    startAdapter,
    checkCavemanUpdate,
    checkRtkUpdate,
    resumeScheduledTasks,
    cleanupOrphanSessionDirs,
    initializeHttpRuntime,
    providerRuntime,
    logger: log,
})
const {bootGateway} = startupRuntime

export async function startGateway() {
    return bootGateway()
}

function markSessionDeleted(sessionId) {
    projectSessionRuntime?.markSessionDeleted?.(sessionId)
}

function invalidateProjectsCache() {
    projectSessionRuntime?.invalidateProjectsCache?.()
}

// HTTP 路由运行时在此绑定组合根端口；具体路由只读取已注入依赖。
// 必须在 PostgreSQL/Memory 初始化完成后再创建，避免路由闭包捕获初始 null。
let gatewayRouteContext = null
let gatewayHttpRuntime = null
function initializeHttpRuntime() {
gatewayRouteContext = {
    PORT, ALLOW_TOKEN_ENDPOINT, BRIDGE_TOKEN, authenticateBridgeToken, log,
    BUILTIN_MCP,
    VALID_MODEL_MODES, VALID_PERMISSION_MODES, VALID_THINKING_LEVELS,
    isValidSessionId, isDirectoryPath, crypto, resolve,
    resolveSessionCreateMode, resolveRecoveryRuntimeIdentity, resolveSessionResume, resolveResumeModel,
    buildSessionStopResponse, shouldDeferAutomaticQuery,
    encodeProjectName, decodeProjectName, openSessionEventJournal, restoreSessionMirrors,
    persistSessionMirrors,
    normalizeWorkDir,
    persistSessionCatalogSettings, reconcileTaskNotificationIntents,
    scheduleProjectCacheBuild, scheduleSessionBackgroundInitialization,
    finishImProgressReporters, invalidateProjectsCache, markSessionDeleted,
    upsertAdapterBinding, userPreferences, bridgeStateDb,
    getBuiltinResourceState, setBuiltinResourceEnabled,
    getAdapterIdentity, adapterRouteAllowed, adapterOwnsSession, adapterOwnsFocusedSession,
    adapterOwnsProject, readAdapterBindings, readAdapterBinding, writeAdapterBindings, clearAdapterBindings,
    clearAdapterBindingsForSessions, isAdapterSessionActive,
    ADAPTER_CONFIG_PATH, ADAPTER_PLATFORMS, ADAPTER_SESSIONS_PATH, ADAPTER_TOKENS,
    BRIDGE_HOME, BRIDGE_PROVIDER_SETTINGS_PATH, BRIDGE_TOKEN_PATH, SECURE_PAYLOAD_KEY_PATH,
    IM_SOURCES, MODEL, PROVIDERS, PKG_VERSION, NUDGE_ACTIONS,
    BINARY_EXTS, MAX_SNAP_FILES, MAX_SNAP_FILE_BYTES, SNAP_EXCLUDE_DIRS,
    dynamicCache, getLiveQuery, withTimeout, persistDynamicCache,
    loadCliSettings, loadCliSettingsForUpdate, loadBridgeProviderSettings, saveBridgeProviderSettings,
    fetchProviderResponse, validateProviderUrl, buildProviderModelsUrl, buildProviderFallbackUrls,
    readBody, restoreSecretValue, redactSecretMap, restoreSecretMap,
    readJSON, writeJSON, readFileSync, writeFileSync, readdirSync, statSync, lstatSync,
    existsSync, unlinkSync, renameSync, rmSync, mkdirSync, join, dirname, basename, relative,
    safeDecodeURIComponent, safeChildPath, safeBasename,
    sessions, controlClients, getFocusedSessionId, setFocusedSessionId, taskCommands, taskCoordinator, taskWorkbench,
    taskInputQueue, sessionCoordinator, sessionRuntime, sessionCatalogProjectKey,
    scanProjects, listProjectSessions, deleteSessionFiles, findSessionTranscript, resolveSessionTranscript: resolveHistoryTranscript, parseSessionHistory,
    loadTaskState, saveTaskState, recoverTaskState, repairPersistedTaskState, restoreCoordinatorSnapshot,
    loadSessionMap, saveSessionMap, lookupGatewaySessionId, lookupSdkSessionId,
    persistSdkSessionId, removeSdkSessionId, markVisibleSession, removeVisibleSession,
    removeVisibleSessionEverywhere, sessionVisibilitySource, getProjectVisibility,
    getSessionRuntimeState, closeSessionRuntime, stopSessionGeneration, settlePending: settlePendingRuntime,
    query, forkSession, startClaudeAgent, makeQueryOptions, startStreamPump,
    createSessionRuntime, PushStream, createTaskCompletionState, createTaskStatePatch,
    buildFileSnapshot, buildGitContext, currentFileScan, lineDiffStats, computeLineDiff, diffSnapshotVsCurrent,
    saveSnapshot, loadSnapshot, saveCheckpoints, loadCheckpoints, rewindToCheckpoint,
    buildProjectCache, loadProjectCache, saveProjectCache, updateProjectCache,
    getUploadDir, prepareUploadDir, prepareSessionUploadDir, cleanupSessionUploads, parseMultipart,
    describeAttachment, isImageAttachment, isBinaryPath, resolveSafe,
    getAdapterHook, confirmHooks, startAdapter, stopAdapter, restartAdapter,
    sendManualImText,
    clearAdapterPlatformState, listAdapterBindings, loadAdapterConfig, saveAdapterConfig,
    getPersistedPairedUserCount: platform => loadPairedUserCount(BRIDGE_HOME, platform),
    normalizeWeChatBaseUrl, platformEntryFilePath,
    stateRepositories, scheduledTaskStore, scheduledRuns, cron, SCHEDULED_TASKS_FILE,
    getUsageStore: () => stateRepositories()?.usage || bridgeStateDb,
    getSessions: () => sessions,
    getNotificationRepository: () => stateRepositories()?.notification,
    registerScheduledJob, destroyScheduledJob, executeScheduledTask,
        listWorkflows: (...args) => workflowRuntime.listWorkflows(...args),
        workflowRuntime,
        getWorkflow: (...args) => workflowRuntime.getWorkflow(...args),
    saveWorkflow: (...args) => workflowRuntime.saveWorkflow(...args),
    validateWorkflowContent, deleteWorkflowFile,
    runWfScript: runWorkflowPort, parseMeta,
    getRunState: (...args) => workflowRuntime.getRunState(...args),
    queryHistory: (...args) => workflowRuntime.queryHistory(...args),
    presetRunState: (...args) => workflowRuntime.presetRunState(...args),
    stopWorkflow: (...args) => workflowRuntime.stopWorkflow(...args),
    stopWorkflowAgent: (...args) => workflowRuntime.stopWorkflowAgent(...args),
    resumeWorkflowAgent: (...args) => workflowRuntime.resumeWorkflowAgent(...args),
    resumeWorkflow: (...args) => workflowRuntime.resumeWorkflow(...args),
    commitWorkflow: (...args) => workflowRuntime.commitWorkflow(...args),
    loadWfConfig, saveWfConfig, broadcast, broadcastTurn, broadcastTaskLifecycle,
    taskStateForClient, taskStateForError, taskStateForInconclusive, taskStateForStop,
    taskStateFromCompletion, taskStateWithNotificationIntents, taskCompletionEventForClient,
    updateTaskState, updateTaskCompletion, transitionTaskCompletion, taskStateStorePath,
    getMemoryService: () => memoryService,
    memoryService, listProjectMemory, listProjectMemoryAsync, saveProjectMemory, saveProjectMemoryAsync, rebuildProjectMemory, rebuildProjectMemoryAsync, deleteProjectMemory, deleteProjectMemoryAsync,
    memoryCandidateStore,
    setProjectMemoryEnabled, setProjectMemoryEnabledAsync, checkAiLayerHealth, detectRuleDrift,
    resourceConfigRoutes,
    configRoutes,
}
Object.defineProperty(gatewayRouteContext, 'adapterConfigReadError', {
    enumerable: true,
    get: () => adapterConfigRuntime.getAdapterConfigReadError(),
})
gatewayRouteContext.getFocusedSessionId = getFocusedSessionId
gatewayRouteContext.setFocusedSessionId = setFocusedSessionId
gatewayRouteContext.getStorageHealth = () => storageGateway?.health?.() || {mode: 'not_configured', healthy: false, reason: 'postgres_storage_not_configured'}
gatewayRouteContext.getState = () => bridgeStateDb
gatewayRouteContext.getRepositories = stateRepositories
gatewayRouteContext.getPitfallAdmin = () => pitfallAdmin
gatewayRouteContext.getAiHealth = () => checkAiLayerHealth({bridgeHome: BRIDGE_HOME})
gatewayRouteContext.getDriftCandidates = detectRuleDrift
gatewayRouteContext.resourceConfigRoutes = resourceConfigRoutes
gatewayHttpRuntime = createHttpRuntime({routeContext: gatewayRouteContext})
handleHttpRequest = gatewayHttpRuntime.handleHttpRequest
}

async function scanProjects() {
    return projectSessionRuntime.scanProjects()
}

async function listProjectSessions(ed) {
    return projectSessionRuntime.listProjectSessions(ed)
}

function resolveHistoryTranscript({sessionId, projectHint = '', workDir = ''} = {}) {
    return resolveSessionTranscriptLocation({
        bridgeHome: BRIDGE_HOME,
        sessionId,
        projectHint,
        workDir,
        repository: stateRepositories()?.session,
    })
}

async function deleteSessionFiles(sessionId, relatedSessionIds = []) {
    return projectSessionRuntime.deleteSessionFiles(sessionId, relatedSessionIds)
}

// ════════════════════════ 记录点（Checkpoint）持久化 + 回退 ════════════════════════
// 每轮用户消息 = 一个记录点，只存改动文件的「修改前内容」增量，落盘项目存储跨重启存活。

sessionIdentityRuntime = createSessionIdentityRuntime({
    bridgeHome: BRIDGE_HOME,
    encodeProjectName,
    readJSON,
    writeJSON,
    readdirSync,
    statSync,
    loadSessionVisibility,
    ensureSessionCatalogIdentity,
    invalidateProjectsCache: () => projectSessionRuntime?.invalidateProjectsCache?.(),
    logger: log,
})

projectSessionRuntime = createProjectSessionRuntime({
    bridgeHome: BRIDGE_HOME,
    projectsCacheTtl: 10_000,
    getScheduledTasks: () => scheduledTaskStore.list(),
    deletedSessionsFile: join(BRIDGE_HOME, 'bridge-deleted-sessions.json'),
    readJSON,
    writeJSON,
    readdirSync,
    statSync,
    existsSync,
    readFileHeadLines,
    classifyTranscriptFile,
    decodeProjectName,
    encodeProjectName,
    normalizeWorkDir,
    reconcileSessionCatalog,
    loadSessionVisibility,
    markSessionVisible,
    migrateLegacySessionVisibility,
    removeSessionVisibility,
    sessionVisibilitySource,
    shouldShowSession,
    loadTaskState,
    getPersistedMirrors,
    sessionMirrorStorePath,
    sessionVisibilityStorePath,
        getSessionRepository: () => stateRepositories()?.session,
    saveSessionVisibility,
    loadSessionMap,
    saveSessionMap,
    getProjectVisibility,
    deleteSession,
    removeSessionMapEntry,
    removePersistedSessionMirrors,
    logger: log,
})

// ── 基线快照持久化（让文件面板「仅改动」在重启/resume 后仍以会话起始为基线）──
// SIDE_EFFECT: 读写 bridge-snapshot/<sessionId>.json
/* Session Artifact Runtime 在文件扫描依赖初始化后接线。 */
