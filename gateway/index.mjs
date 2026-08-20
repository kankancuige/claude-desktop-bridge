/**
 * Claude Desktop Bridge — Gateway (SDK 0.3.179)
 * https://github.com/kankancuige/claude-desktop-bridge
 * query() + PushStream — MCP/工具直接透传，兼容 DeepSeek。
 */

import {createServer, request as httpRequest} from 'node:http'
import {request as httpsRequest} from 'node:https'
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
import {createLogger, logHttpRequest} from './shared/logger.mjs'
import {buildSessionStopResponse, getSessionStopScope, hasStoppableSessionWork} from './sessions/session-stop.mjs'
import {resolveSessionResume} from './sessions/session-resume.mjs'
import {getSessionRuntimeState} from './sessions/session-runtime-state.mjs'
import {classifyTranscriptFile} from './projects/transcript-classifier.mjs'
import {parseSessionHistory} from './sessions/session-history.mjs'
import {findSessionTranscript, listProjectTranscriptCandidates} from './projects/project-transcript-location.mjs'
import {removeSessionMapEntry, resolveMappedGatewaySessionId, updateSessionMap} from './sessions/session-map-consistency.mjs'
import {isUserSessionSource, loadSessionVisibility, markSessionVisible, migrateLegacySessionVisibility, removeSessionVisibility, sessionVisibilitySource, shouldShowSession} from './sessions/session-visibility.mjs'
import {initialSessionIdentity, resolveSessionCreateMode} from './sessions/session-create-mode.mjs'
import {createSessionRuntime} from './sessions/session-runtime.mjs'
import {getPersistedMirrors, mirrorSessionIds, mirrorStorePath, removePersistedMirrors, setPersistedMirror, setPersistedMirrors} from './sessions/session-mirror-state.mjs'
import {reconcileSessionCatalog} from './sessions/session-catalog.mjs'
import {buildProjectContinuationContext, composeContinuationPrompt} from './projects/project-continuation-context.mjs'
import {buildAgentDescriptor, buildAgentToolLifecycleEvent} from './agents/agent-tool-lifecycle.mjs'
import {startWeChatAdapter} from './im/wechat.mjs'
import {startFeishuAdapter} from './im/feishu.mjs'
import {startDingTalkAdapter} from './im/dingtalk.mjs'
import {
    setDeps,
    listWorkflows,
    getWorkflow,
    saveWorkflow,
    validateWorkflowContent,
    deleteWorkflow as deleteWorkflowFile,
    runWorkflow as runWfScript,
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
import {startDeepSeekProxy, getProxyUrl, stopDeepSeekProxy, isProxyConfiguredFor} from './providers/deepseek-proxy.mjs'
import {startOpenCodeProxy, getOpenCodeProxyUrl, stopOpenCodeProxy, isOpenCodeProxyRunning} from './providers/opencode-proxy.mjs'
import {validateProviderUrl, resolveProviderUrl, resolveProviderRedirect, buildProviderModelsUrl, buildProviderFallbackUrls, createPinnedLookup} from './security/provider-url-security.mjs'
import {listAdapterBindings, normalizeAdapterBindings, removeAdapterBindings, upsertAdapterBinding} from './im/adapter-bindings.mjs'
import {readNotificationSummary} from './im/notification-outbox.mjs'
import {scheduleSessionBackgroundInitialization} from './sessions/session-background-init.mjs'
import {
    buildIncompleteMirrorText,
    canResumeTask,
    classifyTaskResult,
    looksLikeIncompleteTransportFailure,
} from './tasks/task-result-outcome.mjs'
import {isAutoContinuationPrompt, resolveAutoContinuation} from './tasks/task-auto-continuation.mjs'
import {createTaskStatePatch, recoverTaskState, taskStateForClient, taskStateForError, taskStateForStop, taskStateFileId} from './tasks/task-state.mjs'
import {clearPlatformEntries, platformEntryFilePath} from './im/platform-entry-store.mjs'
import {createTurnIdentity, shouldDeliverTurnEvent, shouldRouteMirror} from './tasks/turn-routing.mjs'
import {normalizeWeChatBaseUrl} from './im/wechat-url.mjs'
import {migrateAdapterConfig, readAdapterConfig, writeAdapterConfig} from './im/adapter-config.mjs'
import {configureSecurePayloadMasterKey} from './security/secure-payload.mjs'
import {extractWebSocketToken} from './security/websocket-auth.mjs'
import {redactSecretMap, restoreSecretMap, restoreSecretValue} from './security/config-redaction.mjs'
import {buildWindowsRtkExtractArgs, buildWindowsRtkExtractEnv, selectRtkReleaseAsset, verifyRtkAssetDigest} from './tools/rtk-archive.mjs'
import {getCodexRelayProxyUrl, startCodexRelayProxy, stopCodexRelayProxy} from './providers/codex-relay-proxy.mjs'
import {extractBridgeProviderSettings, normalizeBridgeProviderSettings, overlayBridgeProviderSettings, stripBridgeProviderSettings} from './providers/bridge-provider-settings.mjs'
import {applyContextProfile, classifyContextProfile, normalizeContextProfile} from './context/context-profile.mjs'
import {decideTask} from './tasks/task-decision.mjs'
import {shouldCaptureTurnCheckpoint} from './tasks/turn-checkpoint-policy.mjs'
import {normalizeExplicitModel, resolveTaskModelRoute, resolveTurnModelRoute, shouldDeferAutomaticQuery, shouldValidateProviderModel, validateProviderModel} from './tasks/model-routing.mjs'
import {resolveWorkflowFinalReviewTier, shouldAutoTriggerWorkflow} from './workflows/workflow-model-routing.mjs'
import {createTaskCompletionState, normalizeReviewOutcome, resolveFinalReviewPlan, transitionTaskCompletion} from './tasks/task-completion.mjs'
import {createTaskLifecycleSnapshot} from './tasks/task-lifecycle.mjs'
import {createTaskCommandService} from './tasks/task-command.mjs'
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
import {resolveRtkCommandArgs} from './tools/rtk-command.mjs'
import {describeAttachment, isImageAttachment} from './tools/attachment-type.mjs'
import {cleanupUploadDir, prepareUploadDir} from './tools/upload-storage.mjs'
import {mapStreamEvent} from './sessions/stream-event-mapper.mjs'
import {parseDeepSeekBalance, resolveBalanceProvider} from './providers/balance-provider.mjs'
import {createUserPreferenceService} from './context/user-preferences.mjs'
import {createBridgeStateDb} from './storage/bridge-state-db.mjs'
import {createMemoryService} from './context/memory-service.mjs'
import {
    deleteProjectMemory,
    listProjectMemory,
    rebuildProjectMemory,
    saveProjectMemory,
    setProjectMemoryEnabled,
} from './context/memory-admin.mjs'
import {createImProgressReporter} from './im/im-progress-reporter.mjs'
import {
    calculateAutoCompactWindow,
    compactBoundaryToEvent,
    contextUsageEvent,
    isSyntheticCompactSummary,
    parseTokenCount,
} from './context/context-lifecycle.mjs'
let _proxyStarting = null
// 同一项目只允许一个后台索引任务，避免连续新建会话重复扫描同一目录。
const projectCacheBuilds = new Map()
const PROJECT_CACHE_IDLE_DELAY_MS = 1500

function scheduleProjectCacheBuild(workDir) {
    const projectCachePath = cacheFilePath(workDir)
    if (!projectCachePath || existsSync(projectCachePath) || projectCacheBuilds.has(workDir)) return

    // 新会话响应后优先让出事件循环给 WebSocket 握手、首条消息和 IM 聚焦。
    // project-cache 会扫描并解析整个项目，虽然内部会分批让出事件循环，首次同步扫描仍可能阻塞数秒；
    // 延迟到连接稳定后再启动，避免点击“新增会话”时 UI 长时间停留在 loading。
    const job = new Promise(resolve => {
        const timer = setTimeout(resolve, PROJECT_CACHE_IDLE_DELAY_MS)
        timer.unref?.()
    })
        .then(() => buildProjectCache(workDir))
        .then(cache => {
            if (cache) saveProjectCache(workDir, cache)
        })
        .catch(error => log.warn({err: error, workDir}, '后台 project-cache 构建失败'))
        .finally(() => projectCacheBuilds.delete(workDir))
    projectCacheBuilds.set(workDir, job)
}
let _ocProxyStarting = null
import cron from 'node-cron'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({path: join(__dirname, '.env'), override: true})
const log = createLogger('gateway')
let bridgeStateDb = null
let memoryService = null

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

function startClaudeAgent(prompt, options, requirements = {}) {
    return claudeAgentProvider.start(
        {prompt, options},
        requirementsForAgentStart({options, ...requirements}),
    )
}

// ── 版本号（读取本 package.json 的 version 字段）──
const PKG_VERSION = (() => {
    try { return JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')).version || '0.0.0' } catch { return '0.0.0' }
})()

const PORT = parseInt(process.env.PORT || '3456', 10)
// npm 全局包解析: 从 shim 所在目录找到 node_modules/@anthropic-ai/claude-code 下的可用入口
// 旧版 npm 包提供 cli.js，新版提供 bin/claude.exe (native binary)，二者选其一
function resolveFromPkgDir(pkgDir) {
    if (!existsSync(pkgDir)) return null
    for (const rel of ['bin/claude.exe', 'cli.js']) {
        const p = join(pkgDir, rel)
        if (existsSync(p)) return p
    }
    return null
}

let _exe = null

function getClaudeExe() {
    // 缓存失效：文件不存在时重置 _exe 强制重新扫描（防止卸载后残留路径）
    if (_exe) {
        if (existsSync(_exe)) return _exe
        _exe = null
    }

    // ── 1. 显式指定 ──
    if (process.env.CLAUDE_EXE) return (_exe = process.env.CLAUDE_EXE)
    const cliS = loadCliSettings()
    if (cliS.claudeExe && existsSync(cliS.claudeExe)) return (_exe = cliS.claudeExe)

    // ── 2. 已知原生安装路径 ──
    const base = join(homedir(), 'AppData', 'Local', 'Claude-3p', 'claude-code')
    if (existsSync(base)) {
        const vers = readdirSync(base).filter(d => statSync(join(base, d)).isDirectory()).sort().reverse()
        for (const v of vers) {
            const exe = join(base, v, 'claude.exe')
            if (existsSync(exe)) return (_exe = exe)
        }
    }
    // macOS: Claude-3p 第三方安装 / Claude 官方 App
    const macBase = join(homedir(), 'Library', 'Application Support', 'Claude-3p', 'claude-code')
    if (existsSync(macBase)) {
        const vers = readdirSync(macBase).filter(d => statSync(join(macBase, d)).isDirectory()).sort().reverse()
        for (const v of vers) {
            const exe = join(macBase, v, 'claude')
            if (existsSync(exe)) return (_exe = exe)
        }
    }
    // Linux: ~/.local/share/Claude-3p/claude-code/
    const linuxBase = join(homedir(), '.local', 'share', 'Claude-3p', 'claude-code')
    if (existsSync(linuxBase)) {
        const vers = readdirSync(linuxBase).filter(d => statSync(join(linuxBase, d)).isDirectory()).sort().reverse()
        for (const v of vers) {
            const exe = join(linuxBase, v, 'claude')
            if (existsSync(exe)) return (_exe = exe)
        }
    }
    for (const p of [
        join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
        join(homedir(), 'AppData', 'Local', 'Programs', 'claude-code', 'claude.exe'),
        // macOS Homebrew
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
        // macOS 官方 Claude App 内嵌 CLI
        join(homedir(), 'Library', 'Application Support', 'Claude', 'claude'),
        // Linux 常见路径
        join(homedir(), '.local', 'bin', 'claude'),
        '/usr/bin/claude',
    ]) {
        if (existsSync(p)) return (_exe = p)
    }

    // ── 3. PATH 查找 ──
    // .exe / .js / .mjs → 直接使用
    // .cmd / .bat / 无扩展名 → npm 全局安装 shim，从同目录 node_modules 解析实际包
    try {
        const cmd = process.platform === 'win32' ? 'where claude' : 'which claude'
        const raw = execSync(cmd, {encoding: 'utf8', timeout: 3000}).trim().split('\n')[0].trim()
        if (raw && existsSync(raw)) {
            if (raw.endsWith('.exe') || raw.endsWith('.js') || raw.endsWith('.mjs')) return (_exe = raw)
            // shim: 同目录下 node_modules/@anthropic-ai/claude-code/
            const r = resolveFromPkgDir(join(dirname(raw), 'node_modules', '@anthropic-ai', 'claude-code'))
            if (r) return (_exe = r)
        }
    } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }

    // ── 4. npm root -g (以 npm 权威答案兜底) ──
    try {
        const root = execSync('npm root -g', {encoding: 'utf8', timeout: 5000}).trim()
        if (root) {
            const r = resolveFromPkgDir(join(root, '@anthropic-ai', 'claude-code'))
            if (r) return (_exe = r)
        }
    } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }

    // ── 5. nvm/fnm/Volta 版本目录 ──
    const nvmHomes = [
        process.env.NVM_HOME, process.env.NVM_DIR,
        join(homedir(), 'AppData', 'Roaming', 'nvm'),
        join(homedir(), '.nvm'),
        join(homedir(), '.nvm', 'versions', 'node'),
        // fnm (Fast Node Manager)
        join(homedir(), 'AppData', 'Local', 'fnm'),
        join(homedir(), 'AppData', 'Local', 'fnm-node-versions'),
        join(homedir(), '.local', 'share', 'fnm'),
        // Volta
        join(homedir(), '.volta', 'tools', 'image', 'node'),
    ].filter(Boolean)
    for (const nvmHome of nvmHomes) {
        if (!existsSync(nvmHome)) continue
        try {
            const vers = readdirSync(nvmHome)
                .filter(d => /^v\d/.test(d) && statSync(join(nvmHome, d)).isDirectory())
                .sort().reverse()
            for (const v of vers) {
                for (const sub of ['node_modules', 'lib/node_modules']) {
                    const r = resolveFromPkgDir(join(nvmHome, v, sub, '@anthropic-ai', 'claude-code'))
                    if (r) return (_exe = r)
                }
            }
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
    }

    // ── 6. 常见全局路径兜底 ──
    const npmGlobalRoots = [
        join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules'),
        process.env.NVM_SYMLINK ? join(process.env.NVM_SYMLINK, 'node_modules') : null,
        process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules') : null,
        process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs', 'node_modules') : null,
        process.env.PREFIX ? join(process.env.PREFIX, 'node_modules') : null,
    ].filter(Boolean)
    for (const root of npmGlobalRoots) {
        const r = resolveFromPkgDir(join(root, '@anthropic-ai', 'claude-code'))
        if (r) return (_exe = r)
    }

    return (_exe = null)  // 找不到 → 前端弹窗提示
}

const MODEL = process.env.ANTHROPIC_MODEL || 'deepseek-v4-pro'
// SDK 长时间没有任何事件时收口为可恢复中断，避免上游断流后 async iterator 永久挂起。
// 可用 BRIDGE_STREAM_IDLE_TIMEOUT_MS 调整，默认 3 分钟；工具有持续 progress 事件时不会触发。
const STREAM_IDLE_TIMEOUT_MS = Math.min(30 * 60 * 1000, Math.max(30 * 1000,
    Number.parseInt(process.env.BRIDGE_STREAM_IDLE_TIMEOUT_MS || '180000', 10) || 180000))

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
// 本地 API 认证 token: 启动时生成随机 token，写入文件供桌面端读取
// 所有 POST/PUT/DELETE 请求须携带 x-bridge-token header 与此匹配
const BRIDGE_TOKEN = crypto.randomUUID()
function persistBridgeToken() {
    mkdirSync(BRIDGE_HOME, {recursive: true})
    writeFileSync(BRIDGE_TOKEN_PATH, BRIDGE_TOKEN, {encoding: 'utf8', mode: 0o600})
}
const ALLOW_TOKEN_ENDPOINT = process.env.BRIDGE_ALLOW_TOKEN_ENDPOINT === '1'
const ADAPTER_PLATFORMS = ['wechat', 'feishu', 'dingtalk']
const NUDGE_ACTIONS = new Set(['switch_project', 'switch_session', 'new_session', 'toggle_mirror', 'stop'])
// Adapter 只拿到按平台派生的进程内 token；主 token 不会传入 Adapter。
const ADAPTER_TOKENS = new Map(ADAPTER_PLATFORMS.map((platform) => [
    platform,
    crypto.createHmac('sha256', BRIDGE_TOKEN).update(`adapter:${platform}`).digest('hex'),
]))
let adapterConfigReadError = null

function tokenMatches(received, expected) {
    if (typeof received !== 'string' || typeof expected !== 'string') return false
    const a = Buffer.from(received)
    const b = Buffer.from(expected)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function authenticateBridgeToken(received) {
    if (tokenMatches(received, BRIDGE_TOKEN)) return {kind: 'desktop'}
    for (const [platform, token] of ADAPTER_TOKENS) {
        if (tokenMatches(received, token)) return {kind: 'adapter', platform}
    }
    return null
}

function loadAdapterConfig({strict = false} = {}) {
    try {
        const config = readAdapterConfig(ADAPTER_CONFIG_PATH, {keyPath: SECURE_PAYLOAD_KEY_PATH})
        adapterConfigReadError = null
        return config
    } catch (error) {
        adapterConfigReadError = String(error?.message || error)
        if (strict) throw error
        log.error({err: error}, 'IM 加密配置读取失败')
        return {}
    }
}

function saveAdapterConfig(config) {
    writeAdapterConfig(ADAPTER_CONFIG_PATH, config, {keyPath: SECURE_PAYLOAD_KEY_PATH})
    adapterConfigReadError = null
}

function migrateAdapterCredentials() {
    let config = {}
    if (existsSync(ADAPTER_CONFIG_PATH)) {
        const result = migrateAdapterConfig(ADAPTER_CONFIG_PATH, {keyPath: SECURE_PAYLOAD_KEY_PATH})
        config = result.config
        if (result.migrated) log.info('IM 凭据已从明文配置迁移为加密存储')
    }

    const legacyWechatPath = join(BRIDGE_HOME, 'channels', 'wechat', 'default', 'account.json')
    if (existsSync(legacyWechatPath)) {
        const legacy = readJSON(legacyWechatPath)
        if (!config.wechat?.botToken && legacy?.token) {
            config.wechat = {
                ...(config.wechat || {}),
                botToken: legacy.token,
                accountId: legacy.botId || config.wechat?.accountId || '',
                baseUrl: normalizeWeChatBaseUrl(legacy.baseUrl),
            }
            saveAdapterConfig(config)
            log.info('微信旧版账号凭据已迁移为加密存储')
        }
        if (config.wechat?.botToken) {
            try { unlinkSync(legacyWechatPath) } catch (error) {
                log.warn({err: error}, '微信旧版明文账号文件清理失败')
            }
        }
    }
    return config
}

function safeDecodeURIComponent(value) {
    try {
        return decodeURIComponent(String(value || ''))
    } catch {
        return ''
    }
}

// ---- 动态模型/命令缓存 ----
// supportedModels()/supportedCommands() 是控制请求，需活跃 query；冷启动设置页读这里的缓存
// SIDE_EFFECT: mutates dynamicCache（内存）+ 落盘 bridge-dynamic-cache.json
const DYNAMIC_CACHE_FILE = join(BRIDGE_HOME, 'bridge-dynamic-cache.json')
const dynamicCache = {models: null, commands: null, agentNames: null, updatedAt: 0}
// 启动时从磁盘恢复缓存（失败忽略，保持空缓存）
try {
    const c = readJSON(DYNAMIC_CACHE_FILE);
    if (c) Object.assign(dynamicCache, c)
} catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }

let _persistDynamicTimer = null
function persistDynamicCache() {
    // 防抖 500ms: system_init 可能并发触发多次，避免重复写盘
    if (_persistDynamicTimer) clearTimeout(_persistDynamicTimer)
    _persistDynamicTimer = setTimeout(() => {
        _persistDynamicTimer = null
        try {
            writeFileSync(DYNAMIC_CACHE_FILE, JSON.stringify(dynamicCache), 'utf8')
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
    }, 500)
}

// 取一个「已初始化」的活跃 query，用于发控制请求；没有则返回 null
// 功能说明: 获取一个"已初始化"的活跃 query 实例，用于发控制请求（supportedModels/Commands 等）
// 实现方式: 优先返回 focusedSessionId 的 query，其次遍历所有 sessions 找有 query 的
//   返回 null 表示当前没有可用的 query，调用方应回退到缓存
// 关键数据流: focusedSessionId → sessions[].query 查找 → query 对象 或 null
function getLiveQuery() {
    // 优先 focused，其次任意有 query 的 session
    if (focusedSessionId) {
        const s = sessions.get(focusedSessionId);
        if (s?.query) return s.query
    }
    for (const s of sessions.values()) {
        if (s.query) return s.query
    }
    return null
}

// 控制请求加超时保护：query 未就绪时 supportedModels/Commands 可能 hang 住 HTTP 响应
// 功能说明: 给 Promise 加超时保护，避免控制请求（supportedModels/Commands）在 query 未就绪时 hang 住 HTTP 响应
// 实现方式: Promise.race(原始, setTimeout(reject)) → 超时 ms 后 reject 或原始完成则正常 resolve
// 关键数据流: promise + timeout → race → resolve 或 reject('timeout')
function withTimeout(promise, ms) {
    let timer
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms) })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function closeSessionRuntime(session, {sessionId = '', reason = 'unknown', timeoutMs = 5000} = {}) {
    if (!session) return {pushStreamClosed: true, queryClosed: true}
    let pushStreamClosed = true
    let queryClosed = true
    try {
        session.pushStream?.close()
    } catch (error) {
        pushStreamClosed = false
        log.warn({err: error, sessionId: sessionId?.slice(0, 8), reason}, '关闭 Session 输入流失败')
    }
    try {
        const closing = session.query?.return?.()
        if (closing && typeof closing.then === 'function') {
            await withTimeout(Promise.resolve(closing), timeoutMs)
        }
    } catch (error) {
        queryClosed = false
        log.warn({err: error, sessionId: sessionId?.slice(0, 8), reason}, '关闭 Session query 失败')
    }
    return {pushStreamClosed, queryClosed}
}

// ---- 文件快照 Diff：常量 ----
// SIDE_EFFECT: 无（纯常量）
const SNAP_EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out',
    '.cache', '.vscode', '.idea', 'coverage', '.nuxt', '.output', '.turbo', 'target',
    '__pycache__', '.venv', 'venv'])
const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf',
    '.zip', '.gz', '.tar', '.7z', '.exe', '.dll', '.so', '.dylib', '.woff', '.woff2', '.ttf',
    '.otf', '.mp3', '.mp4', '.mov', '.wav', '.webm', '.class', '.jar', '.pyc', '.wasm', '.node', '.bin'])
const MAX_SNAP_FILE_BYTES = 512 * 1024  // 单文件超过此大小不存内容、不做 diff
const MAX_SNAP_FILES = 5000             // 文件总数上限，超过进入 degraded 模式

// ---- PushStream for multi-turn ----
// ── PushStream 异步消息队列 ──
// 功能说明: 实现一个可等待的异步消息队列，用于将用户消息推入 SDK query 的 prompt 流
//   支持多轮对话：用户发消息 → push() 推入队列 → SDK query 通过 asyncIterator 消费 → 开始新轮次
// 实现方式: 内部维护 _buf 数组和 _resolve Promise 回调，push() 有等待者则直接 resolve，否则暂存；close() 终止迭代
//   Symbol.asyncIterator 将队列暴露为 async iterable，SDK query 的 prompt 参数接收它作为流式输入
// 关键数据流: pushStream.push(msg) → _buf/_resolve → asyncIterator.next() → SDK query prompt 流 → 消费消息
class PushStream {
    constructor() {
        this._buf = [];
        this._resolve = null;
        this._closed = false
    }

    // 功能说明: 入队一条消息；如果有消费者在 await next() 则立即交付，否则暂存到 _buf
    // 实现方式: O(1) —— 检查 _resolve 是否存在（有等待者）→ 直接 resolve；否则 push 到队列
    // 关键数据流: msg → (有等待者? resolve({value:msg}) : _buf.push(msg))
    push(msg) {
        if (this._closed) return
        if (this._resolve) {
            this._resolve({value: msg, done: false});
            this._resolve = null
        } else {
            this._buf.push(msg)
        }
    }

    close() {
        this._closed = true;
        if (this._resolve) {
            this._resolve({value: undefined, done: true});
            this._resolve = null
        }
    }

    [Symbol.asyncIterator]() {
        const self = this
        return {
            next() {
                return new Promise(r => {
                    if (self._buf.length) r({value: self._buf.shift(), done: false})
                    else if (self._closed) r({value: undefined, done: true})
                    else self._resolve = r
                })
            }
        }
    }
}

// ---- Session pool ----
const sessions = new Map()
let focusedSessionId = null
const IM_SOURCES = new Set(['wechat', 'feishu', 'dingtalk'])
const MAX_SESSION_INPUT_QUEUE = 32
const VALID_PERMISSION_MODES = new Set(['default', 'acceptEdits', 'plan', 'bypassPermissions'])
const VALID_THINKING_LEVELS = new Set(['auto', 'off', 'low', 'medium', 'high', 'xhigh', 'max'])
const VALID_MODEL_MODES = new Set(['auto', 'fixed'])

function taskStateStorePath(workDir, sessionId) {
    const safeId = taskStateFileId(sessionId, null)
    return safeId ? join(BRIDGE_HOME, 'projects', encodeProjectName(workDir), 'bridge-task-state', `${safeId}.json`) : null
}

function sessionMirrorStorePath(workDir) {
    return mirrorStorePath(join(BRIDGE_HOME, 'projects', encodeProjectName(workDir)))
}

function sessionMirrorIds(session, sessionId = null) {
    return mirrorSessionIds(sessionId, session?.lastSessionId, session?.taskState?.sdkSessionId,
        session?.taskState?.historySessionId, session?.queryOpts?.resume)
}

function sessionCatalogProjectKey(workDir) {
    return encodeProjectName(normalizeWorkDir(workDir))
}

function sessionCatalogIds(session, sessionId = null) {
    return sessionMirrorIds(session, sessionId)
}

function ensureSessionCatalogIdentity(workDir, gatewaySessionId, sdkSessionId, source = 'desktop') {
    if (!bridgeStateDb?.available || !workDir || !sdkSessionId) return false
    try {
        const projectKey = sessionCatalogProjectKey(workDir)
        const projectDir = join(BRIDGE_HOME, 'projects', projectKey)
        const transcriptPath = join(projectDir, `${sdkSessionId}.jsonl`)
        const stat = existsSync(transcriptPath) ? statSync(transcriptPath) : null
        if (!stat?.isFile()) return false
        bridgeStateDb.upsertSessionCatalog({
            projectKey,
            sessionId: sdkSessionId,
            sdkSessionId,
            workDir,
            source: isUserSessionSource(source) ? source : 'desktop',
            visibility: 'visible',
            transcriptPath,
            mtime: stat?.mtimeMs || 0,
            size: stat?.size || 0,
            title: sdkSessionId.slice(0, 8),
        })
        return true
    } catch (error) {
        log.warn({err: error, workDir, sessionId: sdkSessionId?.slice?.(0, 8)}, 'Session SQLite 身份索引保存失败')
        return false
    }
}

function readSessionCatalogSettings(session, sessionId = null) {
    if (!bridgeStateDb?.available || !session?.workDir) return null
    const projectKey = sessionCatalogProjectKey(session.workDir)
    for (const id of sessionCatalogIds(session, sessionId)) {
        const row = bridgeStateDb.getSessionCatalog(projectKey, id)
        if (row) return row
    }
    return null
}

function persistSessionCatalogSettings(session, sessionId = null, patch = {}) {
    if (!bridgeStateDb?.available || !session?.workDir) return false
    try {
        const ids = sessionCatalogIds(session, sessionId)
        const projectKey = sessionCatalogProjectKey(session.workDir)
        const existing = ids.some(id => bridgeStateDb.getSessionCatalog(projectKey, id))
        if (!existing && ids.length > 0) {
            ensureSessionCatalogIdentity(session.workDir, sessionId || ids[0], session.lastSessionId || session.taskState?.sdkSessionId || session.queryOpts?.resume || sessionId || ids[0], session.visibleSource || 'desktop')
        }
        return bridgeStateDb.updateSessionSettingsByIds(
            projectKey,
            ids,
            patch,
        )
    } catch (error) {
        log.warn({err: error, sessionId: sessionId?.slice?.(0, 8)}, 'Session SQLite 设置索引保存失败')
        return false
    }
}

function restoreSessionMirrors(session, sessionId = null) {
    if (!session?.workDir) return false
    try {
        const path = sessionMirrorStorePath(session.workDir)
        const catalog = readSessionCatalogSettings(session, sessionId)
        session.mirrors = catalog?.mirrors || getPersistedMirrors(readJSON(path), sessionMirrorIds(session, sessionId))
        return true
    } catch (error) {
        log.warn({err: error, sessionId: sessionId?.slice?.(0, 8)}, 'Session 镜像状态恢复失败')
        return false
    }
}

function persistSessionMirrors(session, sessionId = null, platform = null, enabled = null) {
    if (!session?.workDir) return false
    try {
        const path = sessionMirrorStorePath(session.workDir)
        const ids = sessionMirrorIds(session, sessionId)
        if (ids.length === 0) return false
        let next = readJSON(path)
        next = platform ? setPersistedMirror(next, ids, platform, enabled === true) : setPersistedMirrors(next, ids, session.mirrors)
        writeJSON(path, next)
        persistSessionCatalogSettings(session, sessionId, {mirrors: session.mirrors})
        return true
    } catch (error) {
        log.warn({err: error, workDir: session.workDir, sessionId: sessionId?.slice?.(0, 8)}, 'Session 镜像状态保存失败')
        return false
    }
}

function removePersistedSessionMirrors(workDir, ids) {
    try {
        const path = sessionMirrorStorePath(workDir)
        const current = readJSON(path)
        if (!current) return true
        const next = removePersistedMirrors(current, ids)
        if (JSON.stringify(next) === JSON.stringify(current)) return true
        writeJSON(path, next)
        return true
    } catch (error) {
        log.warn({err: error, workDir}, 'Session 镜像状态清理失败')
        return false
    }
}

function openSessionEventJournal(workDir, sessionId) {
    const projectDir = join(BRIDGE_HOME, 'projects', encodeProjectName(workDir))
    return new SessionEventJournal({
        path: sessionEventStorePath(projectDir, sessionId),
        onCorrupt: result => {
            log.error({sessionId: sessionId?.slice(0, 8), code: result.code, line: result.line}, 'Session Event Journal 损坏，已隔离并回退兼容快照')
        },
    })
}

function appendSessionEvent(session, type, payload = {}, {critical = false} = {}) {
    if (!session?.eventJournal) {
        if (critical) throw Object.assign(new Error('Session Event Journal 未初始化'), {code: 'SESSION_EVENT_JOURNAL_UNAVAILABLE'})
        return null
    }
    try {
        return session.eventJournal.append(type, payload, {critical})
    } catch (error) {
        if (critical) throw error
        log.warn({err: error, eventType: type}, 'Session Event Journal 写入失败')
        return null
    }
}

function saveTaskState(session, sessionId) {
    try {
        if (!session?.taskState || !session.workDir || !sessionId) return true
        writeJSON(taskStateStorePath(session.workDir, sessionId), session.taskState)
        const sdkSessionId = session.taskState.sdkSessionId || session.lastSessionId
        if (sdkSessionId && sdkSessionId !== sessionId) {
            writeJSON(taskStateStorePath(session.workDir, sdkSessionId), session.taskState)
        }
        return true
    } catch (error) {
        log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, 'task-state 保存失败')
        return false
    }
}

function loadTaskState(workDir, sessionId) {
    const path = taskStateStorePath(workDir, sessionId)
    const fileState = path ? readJSON(path) : null
    if (bridgeStateDb?.available && workDir && sessionId) {
        try {
            const projected = bridgeStateDb.getTaskState(sessionCatalogProjectKey(workDir), sessionId)
            if (projected?.state && typeof projected.state === 'object' && projected.state.status) {
                return recoverTaskState({
                    ...(fileState && typeof fileState === 'object' ? fileState : {}),
                    ...projected.state,
                    // SQLite 不复制正文；兼容快照只补充用户可见内容和审查详情，不能覆盖权威状态。
                    detail: fileState?.detail || '',
                    finalReplyText: fileState?.finalReplyText || '',
                    finalReplyAvailable: fileState?.finalReplyAvailable === true || Boolean(fileState?.finalReplyText),
                    review: {
                        ...(fileState?.review && typeof fileState.review === 'object' ? fileState.review : {}),
                        ...(projected.state.review && typeof projected.state.review === 'object' ? projected.state.review : {}),
                    },
                })
            }
        } catch (error) {
            log.warn({err: error, workDir, sessionId: sessionId?.slice?.(0, 8)}, 'SQLite task-state 投影读取失败，回退文件')
        }
    }
    return fileState ? recoverTaskState(fileState) : null
}

function persistTaskStateProjection(session, sessionId, state, eventType = 'task/state-changed') {
    if (!bridgeStateDb?.available || !session?.workDir || !state) return false
    try {
        const projectKey = sessionCatalogProjectKey(session.workDir)
        const taskKey = state.taskId || state.sdkSessionId || state.historySessionId || sessionId
        const revision = Math.max(1, Number(session._taskStateRevision || 0), Number(state.updatedAt || 0))
        session._taskStateRevision = revision
        return bridgeStateDb.recordTaskTransition({
            projectKey,
            taskKey,
            sessionId,
            taskId: state.taskId,
            sdkSessionId: state.sdkSessionId || state.historySessionId,
            status: state.status,
            outcome: state.outcome,
            continuationReason: state.continuationReason,
            phase: state.status,
            reviewState: state.review?.tier || null,
            modelTier: session.modelTier || session.modelMode || null,
            errorCode: state.continuationReason === 'execution_error' ? 'EXECUTION_ERROR' : null,
            sequence: state.sequence,
            revision,
            startedAt: state.startedAt,
            completedAt: state.completedAt,
            updatedAt: state.updatedAt,
            notifications: state.notifications,
            state,
            eventType,
        })
    } catch (error) {
        log.warn({err: error, sessionId: sessionId?.slice?.(0, 8)}, 'SQLite task-state 投影保存失败，保留文件事实源')
        return false
    }
}

function updateTaskState(session, sessionId, next) {
    if (!session) return null
    // 权限属于会话级设置，但随任务状态同一份安全快照落盘，确保 Gateway 重启后可恢复。
    session.taskState = createTaskStatePatch({
        ...(next && typeof next === 'object' ? next : {}),
        permissionMode: next?.permissionMode || session.permissionMode || session.taskState?.permissionMode || 'default',
    })
    saveTaskState(session, sessionId)
    appendSessionEvent(session, 'task/state-changed', {taskState: journalTaskState(session.taskState)})
    // SQLite 只保存结构化投影；旧 JSON 与 Event Journal 仍作为兼容事实源继续双写。
    session._taskStateRevision = Math.max(Number(session._taskStateRevision || 0) + 1, Number(session.taskState.updatedAt || 0))
    persistTaskStateProjection(session, sessionId, session.taskState)
    return session.taskState
}

function taskStateFromCompletion(session, detail = '') {
    const completion = createTaskCompletionState(session?.taskCompletion)
    const reviewOutcome = completion.reviewOutcome || {}
    const status = completion.phase === 'fixing' ? 'fixing' : completion.phase
    const startedAt = Number(session?.taskStartedAt || session?.taskState?.startedAt || 0)
    const terminal = ['succeeded', 'failed', 'incomplete', 'review_paused', 'stopped', 'interrupted'].includes(status)
    const completedAt = terminal ? Number(session?.taskCompletedAt || Date.now()) : 0
    return createTaskStatePatch({
        status,
        outcome: status === 'succeeded' ? 'succeeded' : status === 'failed' ? 'failed' : status === 'incomplete' ? 'incomplete' : null,
        continuationReason: status === 'failed' || status === 'review_paused' ? 'execution_error' : null,
        resumable: !['succeeded'].includes(status) && Boolean(session?.lastSessionId || session?._hasConversation),
        subtype: session?.lastTaskResult?.subtype || null,
        detail: detail || completion.detail || session?.lastTaskResult?.result || '',
        numTurns: session?.lastTaskResult?.numTurns || 0,
        startedAt,
        completedAt,
        durationMs: startedAt && completedAt ? Math.max(0, completedAt - startedAt) : 0,
        finalReplyText: session?.taskFinalReplyText || session?.taskState?.finalReplyText || '',
        finalReplyAvailable: Boolean(session?.taskFinalReplyText || session?.taskState?.finalReplyText),
        notifications: session?.taskState?.notifications || {},
        permissionMode: session?.permissionMode || session?.taskState?.permissionMode || 'default',
        sdkSessionId: session?.lastSessionId,
        historySessionId: session?.lastSessionId,
        taskId: session?.taskCompletionTaskId || null,
        turnId: session?.taskCompletionTurnId || null,
        sequence: session?._taskCompletionSequence || 0,
        review: {
            round: completion.reviewRound,
            tier: completion.reviewPlan?.tier || null,
            summary: reviewOutcome.summary || completion.detail || '',
            blockingFindings: reviewOutcome.blockingFindings || [],
        },
    })
}

function updateTaskNotificationState(session, sessionId, platform, state, notificationId, lastError = '') {
    if (!session || !platform) return
    const notifications = {...(session.taskState?.notifications || {})}
    notifications[platform] = {state, notificationId: String(notificationId || ''), lastError: String(lastError || ''), updatedAt: Date.now()}
    const nextState = session.taskState
        ? createTaskStatePatch({...session.taskState, notifications, updatedAt: Date.now()})
        : taskStateFromCompletion({...session, taskState: {notifications}})
    updateTaskState(session, sessionId, nextState)
    broadcastTaskLifecycle(sessionId)
}

function updateTaskCompletion(session, sessionId, event) {
    const transition = transitionTaskCompletion(session?.taskCompletion, event)
    if (!session) return transition
    session.taskCompletion = transition.state
    const nextState = taskStateFromCompletion(session)
    const terminalEffect = transition.effects.find(effect => ['complete', 'fail', 'pause'].includes(effect?.type))
    if (terminalEffect) {
        const eventType = terminalEffect.type === 'complete'
            ? 'task_completed'
            : terminalEffect.type === 'pause' ? 'task_review_paused' : 'task_failed'
        const taskId = session.taskCompletionTaskId || sessionId
        const notificationId = `${taskId}:${eventType}`
        const turnIdentity = session.taskCompletionIdentity || session.activeTurnIdentity || null
        const notifications = {...(nextState.notifications || {})}
        for (const [platform, enabled] of Object.entries(session.mirrors || {})) {
            if (!enabled || !['wechat', 'feishu', 'dingtalk'].includes(platform) || !shouldRouteMirror(platform, turnIdentity)) continue
            notifications[platform] = {
                state: 'pending', notificationId, lastError: '', updatedAt: Date.now(),
            }
        }
        nextState.notifications = notifications
    }
    updateTaskState(session, sessionId, nextState)
    return transition
}

function repairPersistedTaskState(state) {
    if (!state || state.status !== 'succeeded') return state
    const text = [state.detail, state.finalReplyText].filter(Boolean).join('\n')
    if (!looksLikeIncompleteTransportFailure(text)) return state
    // 兼容旧版本已把中转站断流文本写成 succeeded 的记录，恢复时纠正为可继续的失败态。
    return {
        ...state,
        status: 'failed',
        outcome: 'failed',
        continuationReason: 'execution_error',
        resumable: Boolean(state.historySessionId || state.sdkSessionId),
        detail: state.detail || state.finalReplyText,
    }
}

function getTaskLifecycleSnapshot(sessionId, session = sessions.get(sessionId)) {
    if (!session) return null
    let workflows = []
    try {
        workflows = getSessionWorkflowStates(sessionId)
    } catch (error) {
        log.debug({err: error, sessionId: sessionId?.slice(0, 8)}, '读取任务生命周期 Workflow 快照失败')
    }
    return createTaskLifecycleSnapshot({
        sessionId,
        runtime: {
            ...getSessionRuntimeState(session),
            taskWorkflowPending: hasPendingTaskWorkflow(session._taskWorkflowGate),
        },
        task: taskStateForSessionClient(session),
        workflows,
    })
}

function broadcastTaskLifecycle(sessionId) {
    const snapshot = getTaskLifecycleSnapshot(sessionId)
    if (snapshot) broadcastDesktop(sessionId, {type: 'session_lifecycle_snapshot', ...snapshot})
}

function isValidSessionId(value) {
    return typeof value === 'string'
        && value.length >= 1
        && value.length <= 128
        && value !== '.'
        && value !== '..'
        && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
}

function isDirectoryPath(value) {
    if (typeof value !== 'string' || !value.trim()) return false
    try {
        return statSync(value).isDirectory()
    } catch {
        return false
    }
}
const pendingQRCodes = new Map()
const UPLOAD_QUOTA_BYTES = 50 * 1024 * 1024
const UPLOAD_TTL_MS = Math.min(30 * 24 * 60 * 60 * 1000, Math.max(5 * 60 * 1000,
    parseInt(process.env.BRIDGE_UPLOAD_TTL_MS || String(24 * 60 * 60 * 1000), 10) || 24 * 60 * 60 * 1000))

function getUploadDir(workDir, sessionId = 'legacy') {
    const root = safeChildPath(workDir, '.bridge-uploads', {allowNested: false})
    return root && isValidSessionId(sessionId) ? safeChildPath(root, sessionId, {allowNested: false}) : null
}

function cleanupSessionUploads(workDir, sessionId = 'legacy', removeAll = false) {
    return cleanupUploadDir(getUploadDir(workDir, sessionId), {
        removeAll,
        ttlMs: UPLOAD_TTL_MS,
        onError: (error, path) => log.debug({err: error, path}, '读取附件元数据失败'),
    })
}

function acceptSessionInput(s, source, messageId, userId = null, taskDecision = null) {
    const now = Date.now()
    if (!s._inputIds) s._inputIds = new Map()
    for (const [id, at] of s._inputIds) {
        if (now - at > 10 * 60 * 1000) s._inputIds.delete(id)
    }
    const id = String(messageId || crypto.randomUUID()).slice(0, 200)
    const dedupeKey = `${String(source || 'desktop')}\0${String(userId || '')}\0${id}`
    if (s._inputIds.has(dedupeKey)) return {ok: false, duplicate: true, messageId: id}
    const queued = (s._pendingInputs?.length || 0) + (s.activeTurnId ? 1 : 0)
    if (queued >= MAX_SESSION_INPUT_QUEUE) return {ok: false, error: 'input_queue_full', queuePosition: queued}
    const turnId = crypto.randomUUID()
    s._inputIds.set(dedupeKey, now)
    if (!Array.isArray(s._pendingInputs)) s._pendingInputs = []
    s._pendingInputs.push({
        messageId: id,
        turnId,
        source,
        userId: IM_SOURCES.has(source) ? String(userId || '') : null,
        taskDecision,
        dedupeKey,
    })
    return {ok: true, messageId: id, turnId, queuePosition: queued, dedupeKey}
}

function rollbackSessionInput(s, accepted) {
    if (!s || !accepted?.turnId) return false
    const index = s._pendingInputs?.findIndex(item => item.turnId === accepted.turnId) ?? -1
    if (index < 0) return false
    s._pendingInputs.splice(index, 1)
    if (accepted.dedupeKey) s._inputIds?.delete(accepted.dedupeKey)
    return true
}

function failPendingSessionInputs(sessionId, s, error) {
    const pending = Array.isArray(s?._pendingInputs) ? s._pendingInputs.splice(0) : []
    s._pendingSources = []
    for (const input of pending) {
        if (input.dedupeKey) s._inputIds?.delete(input.dedupeKey)
        const identity = createTurnIdentity(input.source, input.userId, IM_SOURCES)
        broadcastTurn(sessionId, {
            type: 'error',
            code: error?.code || 'session_input_failed',
            message: String(error?.message || error || '消息处理失败'),
            turnId: input.turnId || null,
        }, identity)
    }
    return pending.length
}

function cancelPendingSessionInputs(sessionId, s) {
    const pending = Array.isArray(s?._pendingInputs) ? s._pendingInputs.splice(0) : []
    s._pendingSources = []
    for (const input of pending) {
        if (input.dedupeKey) s._inputIds?.delete(input.dedupeKey)
        const identity = createTurnIdentity(input.source, input.userId, IM_SOURCES)
        broadcastTurn(sessionId, {
            type: 'generation_stopped',
            turnId: input.turnId || null,
        }, identity)
    }
    return pending.length
}

function clearStreamWatchdog(session, query = null) {
    if (!session) return
    if (query && session._streamWatchdogQuery && session._streamWatchdogQuery !== query) return
    if (session._streamWatchdogTimer) clearTimeout(session._streamWatchdogTimer)
    session._streamWatchdogTimer = null
    session._streamWatchdogQuery = null
}

function armStreamWatchdog(sessionId, session, query) {
    if (!session || !query || session.query !== query || STREAM_IDLE_TIMEOUT_MS <= 0) return
    clearStreamWatchdog(session)
    session._streamWatchdogQuery = query
    session._streamWatchdogTimer = setTimeout(() => {
        if (sessions.get(sessionId) !== session || session.query !== query || !session._generating) return
        session._streamWatchdogTriggered = query
        const detail = `API 超过 ${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)} 秒未返回新事件，已自动中断当前执行；已有修改和会话上下文已保留，可继续执行。`
        const timeoutIdentity = session.activeTurnIdentity ? {...session.activeTurnIdentity} : null
        log.error({sessionId: sessionId?.slice(0, 8), timeoutMs: STREAM_IDLE_TIMEOUT_MS}, 'SDK 流长时间无事件，自动收口')
        const transition = updateTaskCompletion(session, sessionId, {type: 'runtime_failed', detail})
        void applyTaskCompletionEffects(sessionId, transition.effects).catch(error => {
            log.error({err: error, sessionId: sessionId?.slice(0, 8)}, 'SDK 流超时后的任务收口失败')
        })
        session._generating = false
        session.activeTurnId = null
        session.activeTurnIdentity = null
        failPendingSessionInputs(sessionId, session, new Error(detail))
        const completedAt = Date.now()
        session.taskCompletedAt = completedAt
        const startedAt = Number(session.taskStartedAt || session.taskState?.startedAt || completedAt)
        updateTaskState(session, sessionId, taskStateForError(new Error(detail), {
            sdkSessionId: session.lastSessionId,
            historySessionId: session.lastSessionId,
            startedAt,
            completedAt,
            durationMs: Math.max(0, completedAt - startedAt),
        }))
        appendSessionEvent(session, 'runtime/failed', {
            turnId: session.taskState.turnId,
            code: 'stream_idle_timeout',
            durationMs: session.taskState.durationMs,
        })
        broadcastTurn(sessionId, {
            type: 'error',
            code: 'stream_idle_timeout',
            message: detail,
            durationMs: session.taskState.durationMs,
            taskState: taskStateForClient(session.taskState),
        }, timeoutIdentity)
        broadcastTaskLifecycle(sessionId)
        // 先断开 Session 对挂起 query 的引用，允许用户点击“继续执行”时创建新的 SDK query。
        if (session.query === query) session.query = null
        try { session.pushStream?.close() } catch (error) {
            log.debug({err: error, sessionId: sessionId?.slice(0, 8)}, 'SDK 流超时输入流关闭失败')
        }
        session.pushStream = null
        Promise.resolve(query.return?.()).catch(error => {
            log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, 'SDK 流超时关闭失败')
        })
    }, STREAM_IDLE_TIMEOUT_MS)
    session._streamWatchdogTimer.unref?.()
}

async function stopSessionGeneration(sessionId, s) {
    if (!s) return {stopped: false, cancelledInputs: 0}
    if (s._stopPromise) return s._stopPromise
    let workflowStates = []
    try {
        workflowStates = getSessionWorkflowStates(sessionId)
    } catch (error) {
        log.debug({err: error, sessionId: sessionId?.slice(0, 8)}, '读取 Workflow 停止状态失败')
    }
    if (!hasStoppableSessionWork(s, workflowStates)) return {stopped: false, cancelledInputs: 0}
    const operation = (async () => {
        clearStreamWatchdog(s)
        const stopScope = getSessionStopScope(s, workflowStates)
        for (const workflow of stopScope.activeWorkflows) {
            if (workflow.wfId || workflow.name) stopWorkflow(workflow.wfId || workflow.name)
        }
        // 独立 Workflow 不属于父任务；停止它不能关闭 SDK runtime 或改写父任务终态。
        if (!stopScope.primaryActive) {
            broadcastTaskLifecycle(sessionId)
            return {stopped: true, scope: 'workflow', cancelledInputs: 0, turnId: null}
        }
        const stoppedTurnId = s.activeTurnId || null
        const stoppedTurnIdentity = s.activeTurnIdentity ? {...s.activeTurnIdentity} : null
        updateTaskCompletion(s, sessionId, {type: 'user_stopped', detail: '用户已暂停任务'})
        clearTaskWorkflowGate(s._taskWorkflowGate)
        s._internalWorkflowResultTurnId = null
        s._autoContinuationRequest = null
        s.autoContinuationCount = 0
        s.autoContinuationTurns = 0
        // 先失效异步 rebuild token，再等待 SDK 关闭；否则 makeQueryOptions 完成后可能复活已停止任务。
        s._rebuildId = null
        s._pendingMessages = null
        for (const id of [...(s.pending?.keys() || [])]) settlePending(sessionId, id, {
            behavior: 'deny',
            message: '已取消',
            interrupt: true,
        }, 'stopped')
        await closeSessionRuntime(s, {sessionId, reason: 'stop_generation'})
        s.query = null
        s.pushStream = null
        try {
            finalizeCheckpoint(sessionId)
        } catch (error) {
            log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '停止生成时保存 checkpoint 失败')
        }
        s.pendingTurn = null
        s._rebuildPromise = null
        const cancelledInputs = cancelPendingSessionInputs(sessionId, s)
        s._pendingTurns = []
        s._generating = false
        s.activeTurnId = null
        s.activeTurnIdentity = null
        s.lastSessionId = s.lastSessionId || sessionId
        const completedAt = Date.now()
        s.taskCompletedAt = completedAt
        const startedAt = Number(s.taskStartedAt || s.taskState?.startedAt || completedAt)
        updateTaskState(s, sessionId, taskStateForStop({
            sdkSessionId: s.lastSessionId,
            historySessionId: s.lastSessionId,
            startedAt,
            completedAt,
            durationMs: Math.max(0, completedAt - startedAt),
        }))
        appendSessionEvent(s, 'runtime/stopped', {
            turnId: stoppedTurnId,
            cancelledInputs,
            durationMs: s.taskState.durationMs,
        })
        broadcastTurn(sessionId, {
            type: 'generation_stopped',
            turnId: stoppedTurnId,
            durationMs: s.taskState.durationMs,
            taskState: taskStateForClient(s.taskState),
        }, stoppedTurnIdentity)
        broadcastTaskLifecycle(sessionId)
        return {stopped: true, scope: 'primary', cancelledInputs, turnId: stoppedTurnId}
    })()
    s._stopPromise = operation
    try {
        return await operation
    } finally {
        if (s._stopPromise === operation) s._stopPromise = null
    }
}

function markInternalInput(s, taskDecision = null) {
    if (!Array.isArray(s._pendingInputs)) s._pendingInputs = []
    s._pendingInputs.unshift({messageId: null, turnId: null, source: s.lastTurnSource || 'desktop', userId: null, taskDecision})
}

const taskCommands = createTaskCommandService({
    submit: submitTaskCommand,
    cancel: async sessionId => {
        const session = sessions.get(sessionId)
        if (!session) return {stopped: false, code: 'session_not_found'}
        return stopSessionGeneration(sessionId, session)
    },
    onListenerError: (error, context) => {
        log.warn({err: error, sessionId: context.sessionId?.slice(0, 8), eventType: context.eventType}, 'Task observer 处理失败')
    },
})

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

// ---- 确认请求注册表（权限/方案选择双通道）----
let reqCounter = 0
const confirmHooks = []   // [{platform, onConfirmRequest, onConfirmResolved, findUserForSession, sendToUser}] —— 各 IM 适配器注册的钩子
const imProgressReporters = new Map()
const ADAPTER_STARTERS = new Map([
    ['wechat', startWeChatAdapter],
    ['feishu', startFeishuAdapter],
    ['dingtalk', startDingTalkAdapter],
])

function getAdapterHook(platform) {
    return confirmHooks.find(hook => hook.platform === platform) || null
}

function notificationTaskId(notificationId) {
    const match = String(notificationId || '').match(/^(.*):(task_completed|task_failed|task_review_paused)$/)
    return match?.[1] || ''
}

function handleNotificationStateChange({platform, notificationId, state, lastError = ''} = {}) {
    const taskId = notificationTaskId(notificationId)
    if (!platform || !taskId) return false
    const updatedAt = Date.now()
    for (const [sessionId, session] of sessions) {
        if (session?.taskCompletionTaskId !== taskId && session?.taskState?.taskId !== taskId) continue
        updateTaskNotificationState(session, sessionId, platform, state, notificationId, lastError)
        return true
    }
    try {
        return bridgeStateDb?.updateTaskNotification?.({
            taskId, platform, notificationId, state, lastError, updatedAt,
        }) === true
    } catch (error) {
        log.warn({err: error, platform, notificationId}, '通知状态回写 SQLite 任务投影失败')
        return false
    }
}

async function reconcilePersistedNotificationIntents(platform) {
    const hook = getAdapterHook(platform)
    if (!hook || !bridgeStateDb?.available) return 0
    let restored = 0
    for (const task of bridgeStateDb.listTaskNotificationIntents(platform, {limit: 200})) {
        const intent = task.notifications?.[platform]
        if (!intent?.notificationId || hook.notificationState?.(intent.notificationId)) continue
        const catalog = [task.sdkSessionId, task.sessionId]
            .filter(Boolean)
            .map(id => bridgeStateDb.getSessionCatalog(task.projectKey, id))
            .find(Boolean)
        if (!catalog?.workDir || !task.sessionId) continue
        const persisted = loadTaskState(catalog.workDir, task.sdkSessionId || task.sessionId)
            || loadTaskState(catalog.workDir, task.sessionId)
        const text = buildIncompleteMirrorText(persisted?.finalReplyText || persisted?.detail, {
            outcome: task.status === 'succeeded' ? 'succeeded'
                : ['incomplete', 'review_paused'].includes(task.status) ? 'incomplete' : 'failed',
            continuationReason: task.continuationReason || null,
        })
        if (!text) continue
        try {
            const result = await hook.sendToUser(task.sessionId, text, null, intent.notificationId)
            const next = result === true || result?.sent === true
                ? {state: 'sent', lastError: ''}
                : result?.queued === true
                    ? {state: 'pending', lastError: result.error || 'queued_for_retry'}
                    : {state: 'failed', lastError: result?.error || 'send_failed'}
            handleNotificationStateChange({platform, notificationId: intent.notificationId, ...next})
            restored++
        } catch (error) {
            handleNotificationStateChange({
                platform, notificationId: intent.notificationId,
                state: 'failed', lastError: error?.message || error,
            })
            log.warn({err: error, platform, taskId: task.taskId}, '持久化任务通知意图恢复失败')
        }
    }
    return restored
}

function imProgressReporterKey(sessionId, turnId, platform, userId) {
    return [sessionId, turnId || 'turn', platform, userId || 'bound-user'].join(':')
}

function imProgressRecipients(sessionId, identity = null) {
    const session = sessions.get(sessionId)
    if (!session) return []
    const turnIdentity = identity || session.activeTurnIdentity || session.taskCompletionIdentity || null
    if (['wechat', 'feishu', 'dingtalk'].includes(turnIdentity?.source)) {
        const hook = getAdapterHook(turnIdentity.source)
        return hook ? [{hook, userId: turnIdentity.userId || null, mirrored: false}] : []
    }
    return confirmHooks
        .filter(hook => session.mirrors?.[hook.platform] && shouldRouteMirror(hook.platform, turnIdentity))
        .map(hook => ({hook, userId: turnIdentity?.userId || null, mirrored: true}))
}

function finishImProgressReporters(sessionId, turnId = null) {
    const prefix = `${sessionId}:`
    for (const [key, reporter] of imProgressReporters) {
        if (!key.startsWith(prefix) || (turnId && !key.startsWith(`${sessionId}:${turnId}:`))) continue
        reporter.finish()
        imProgressReporters.delete(key)
    }
}

function reportImProgressEvent(sessionId, event, identity = null) {
    const session = sessions.get(sessionId)
    if (!session || !event || typeof event !== 'object') return
    const turnId = event.turnId || session.taskCompletionTurnId || session.activeTurnId || 'turn'
    if (['task_completed', 'task_failed', 'task_review_paused', 'generation_stopped', 'stream_error', 'error'].includes(event.type)) {
        finishImProgressReporters(sessionId, turnId)
        return
    }
    for (const {hook, userId, mirrored} of imProgressRecipients(sessionId, identity)) {
        const key = imProgressReporterKey(sessionId, turnId, hook.platform, userId)
        let reporter = imProgressReporters.get(key)
        if (!reporter) {
            reporter = createImProgressReporter({
                send: async text => {
                    const currentSession = sessions.get(sessionId)
                    const currentHook = getAdapterHook(hook.platform)
                    if (!currentSession || !currentHook) return
                    if (mirrored && !currentSession.mirrors?.[hook.platform]) return
                    await currentHook.sendToUser(sessionId, text, userId)
                },
                onError: error => log.warn({err: error, platform: hook.platform, sessionId: sessionId.slice(0, 8)}, 'IM 阶段进度发送失败'),
            })
            imProgressReporters.set(key, reporter)
        }
        reporter.observe({...event, startedAt: event.startedAt || session.taskStartedAt || 0})
    }
}

function taskStateForSessionClient(session) {
    if (!session?.taskState) return taskStateForClient(session?.taskState)
    const notifications = {...(session.taskState.notifications || {})}
    for (const [platform, current] of Object.entries(notifications)) {
        const live = getAdapterHook(platform)?.notificationState?.(current.notificationId)
        if (!live?.state || live.state === current.state && !live.lastError) continue
        notifications[platform] = {...current, state: live.state, lastError: live.lastError || '', updatedAt: Date.now()}
    }
    return taskStateForClient({...session.taskState, notifications})
}

function stopAdapter(platform) {
    const index = confirmHooks.findIndex(hook => hook.platform === platform)
    if (index < 0) return false
    const [hook] = confirmHooks.splice(index, 1)
    try {
        hook.stop?.()
    } catch (error) {
        log.warn({err: error, platform}, '停止 IM 适配器失败')
    }
    return true
}

function startAdapter(platform) {
    if (getAdapterHook(platform)) return getAdapterHook(platform)
    const starter = ADAPTER_STARTERS.get(platform)
    if (!starter) return null
    try {
        const hooks = starter(ADAPTER_TOKENS.get(platform), {
            taskCommands,
            stateStore: bridgeStateDb,
            onNotificationStateChange: handleNotificationStateChange,
        })
        if (!hooks) return null
        const registered = {...hooks, platform}
        confirmHooks.push(registered)
        for (const [sessionId, session] of sessions) {
            if (session?.taskState?.notifications?.[platform]?.state === 'pending') {
                queueMicrotask(() => reconcileTaskNotificationIntents(sessionId, session, platform))
            }
        }
        queueMicrotask(() => reconcilePersistedNotificationIntents(platform).catch(error => {
            log.warn({err: error, platform}, '适配器启动后恢复待通知任务失败')
        }))
        return registered
    } catch (error) {
        log.error({err: error, platform}, '启动 IM 适配器失败')
        return null
    }
}

function restartAdapter(platform) {
    stopAdapter(platform)
    return startAdapter(platform)
}

function clearAdapterPlatformState(platform) {
    stopAdapter(platform)
    const bindings = clearAdapterBindings(binding => binding.platform === platform)
    const sqliteInbox = bridgeStateDb?.clearEntries?.('inbox', platform) || 0
    const sqliteNotifications = bridgeStateDb?.clearEntries?.('outbox', platform) || 0
    const inbox = sqliteInbox + clearPlatformEntries(platformEntryFilePath(BRIDGE_HOME, 'bridge-im-inbox', platform), platform)
        + clearPlatformEntries(join(BRIDGE_HOME, 'bridge-im-inbox.json'), platform)
    const notifications = sqliteNotifications + clearPlatformEntries(platformEntryFilePath(BRIDGE_HOME, 'bridge-notification-outbox', platform), platform)
        + clearPlatformEntries(join(BRIDGE_HOME, 'bridge-notification-outbox.json'), platform)
    const pairedFiles = {
        wechat: 'bridge-paired.json',
        feishu: 'bridge-paired-feishu.json',
        dingtalk: 'bridge-paired-dingtalk.json',
    }
    let paired = false
    const pairedFile = pairedFiles[platform] ? join(BRIDGE_HOME, pairedFiles[platform]) : null
    if (pairedFile && existsSync(pairedFile)) {
        try {
            unlinkSync(pairedFile)
            paired = true
        } catch (error) {
            log.warn({err: error, platform}, '清理 IM 配对白名单失败')
        }
    }
    return {bindings, inbox, notifications, paired, sqlite: {inbox: sqliteInbox, notifications: sqliteNotifications}}
}

// ── WebSocket 广播 ──
// 功能说明: 向指定 session 的所有已连接 WebSocket 客户端广播一条 JSON 消息
//   这是桌面端实时更新的核心通道：所有 SDK 输出/确认请求都通过此函数推给 UI
// 实现方式: 从 sessions Map 取 session → 遍历 s.clients Set → 对 readyState===1（OPEN）的客户端 send JSON 字符串
//   JSON.stringify 只执行一次（提前序列化），避免重复序列化
// 关键数据流: msg 对象 → JSON.stringify → forEach ws.send(raw) → 桌面端 WebSocket onmessage
function broadcast(sid, msg) {
    const s = sessions.get(sid);
    if (!s) return
    let raw
    try {
        raw = JSON.stringify(msg)
    } catch (error) {
        // 循环引用或 BigInt 等不可序列化值 → 静默丢弃，避免中断整个 broadcast pipeline
        log.debug({err: error, sessionId: sid?.slice(0, 8), messageType: msg?.type}, '序列化广播消息失败')
        return
    }
    // 防御性拷贝: onclose 回调可能删除 s.clients 成员，遍历 Set 时并发修改会漏发
    for (const w of [...s.clients]) {
        if (w.readyState === 1) {
            try {
                w.send(raw)
            } catch (error) {
                s.clients.delete(w)
                log.debug({err: error, sessionId: sid?.slice(0, 8)}, '广播消息发送失败，已移除失效连接')
            }
        }
    }
}

function broadcastTurn(sid, msg, identity = null) {
    const s = sessions.get(sid)
    if (!s) return
    taskCommands.publish(sid, msg, identity)
    reportImProgressEvent(sid, msg, identity)
    let raw
    try {
        raw = JSON.stringify(msg)
    } catch (error) {
        log.debug({err: error, sessionId: sid?.slice(0, 8), messageType: msg?.type}, '序列化回合消息失败')
        return
    }
    for (const ws of [...s.clients]) {
        if (ws.readyState !== 1) continue
        if (!shouldDeliverTurnEvent(ws._source, ws._adapterUserId, identity)) continue
        try { ws.send(raw) } catch (error) {
            log.debug({err: error, sessionId: sid?.slice(0, 8), source: ws._source}, '回合消息发送失败')
        }
    }
}

function broadcastDesktop(sid, msg) {
    broadcastTurn(sid, msg, null)
}

function broadcastWorkflowEvent(sid, msg) {
    const session = sessions.get(sid)
    const workflowState = msg?.workflowId ? getRunState(msg.workflowId) : null
    let settlingDeferredPrimary = false
    if (msg?.type === 'workflow_started' && workflowState?._args?._taskOwned === true) {
        if (!session._taskWorkflowGate) session._taskWorkflowGate = createTaskWorkflowGate()
        attachTaskWorkflow(session._taskWorkflowGate, msg.workflowId)
    } else if (['workflow_done', 'workflow_paused', 'workflow_error'].includes(msg?.type)) {
        const taskOwned = session?._taskWorkflowGate?.active?.has(String(msg.workflowId || ''))
        if (taskOwned) {
            noteTaskWorkflowTerminal(session._taskWorkflowGate, msg.workflowId, {
                returnsToParent: msg.type === 'workflow_done' && workflowState?._args?._returnToParent !== false,
            })
            const deferred = takeDeferredPrimaryResult(session._taskWorkflowGate)
            if (deferred) {
                const transition = updateTaskCompletion(session, sid, deferred)
                settlingDeferredPrimary = transition.effects.length > 0
                void applyTaskCompletionEffects(sid, transition.effects).catch(error => {
                    log.error({err: error, sessionId: sid?.slice(0, 8)}, '任务 Workflow 结束后结算父任务失败')
                })
            }
        }
    }
    if (session && typeof msg?.type === 'string') {
        appendSessionEvent(session, 'workflow/event', {
            eventType: msg.type.slice(0, 120),
            workflowId: typeof msg.workflowId === 'string' ? msg.workflowId.slice(0, 160) : null,
            agentId: typeof msg.id === 'string' ? msg.id.slice(0, 160) : null,
            agentType: typeof msg.agentType === 'string' ? msg.agentType.slice(0, 120) : null,
        })
    }
    reportImProgressEvent(sid, msg, session?.taskCompletionIdentity || null)
    broadcast(sid, msg)
    if (!settlingDeferredPrimary && ['workflow_started', 'workflow_resumed', 'workflow_done', 'workflow_paused', 'workflow_error'].includes(msg?.type)) {
        broadcastTaskLifecycle(sid)
    }
}

// 注入依赖到 workflow-runner，供 Workflow 子进程通过受控 IPC 请求 agent() 调用
setDeps({agentProvider: claudeAgentProvider, deleteSession, makeQueryOptions, loadCliSettings, loadWfConfig, PushStream, broadcast: broadcastWorkflowEvent, sessions, persistSdkSessionId, removeSdkSessionId, encodeProjectName, stateStore: () => bridgeStateDb})

// 收口：任一通道响应或超时都走这里，幂等（已 settled 则忽略）
// ── 确认请求收口（settlePending）──
// 功能说明: 统一收口所有权限/方案选择确认请求的完成，幂等（已 settled 忽略），任一通道响应即生效
//   跨通道（desktop/wechat/feishu/dingtalk）共享同一确认机制：谁先响应谁赢
// 实现方式:
//   1. 从 sessions 取 pending Map，检查 entry 存在且未 settled
//   2. 标记 settled=true，清除超时定时器，从 Map 删除 entry
//   3. 调用 entry.resolve(result) 释放 SDK 的 canUseTool Promise
//   4. broadcast 通知 desktop 弹框关闭 + 遍历 confirmHooks 通知所有适配器清除挂起
// 关键数据流: 任一通道响应(permission_response/choice_response/wechat api)
//   → settlePending() → entry.resolve(decision) → SDK 继续执行/拒绝
//   → broadcast(confirmation_resolved) → 桌面弹框关闭
//   → confirmHooks[].onConfirmResolved() → 各适配器清除挂起状态
function settlePending(sessionId, requestId, result, wonBy) {
    const s = sessions.get(sessionId);
    if (!s) return
    const entry = s.pending?.get(requestId);
    if (!entry || entry.settled) return
    entry.settled = true
    if (entry.timeout) clearTimeout(entry.timeout)
    s.pending.delete(requestId)
    try {
        entry.resolve(result)
    } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
    log.info({
        sessionId: sessionId?.slice(0, 8),
        requestId,
        type: entry.type,
        toolName: entry.toolName,
        decision: result?.behavior || 'unknown',
        wonBy,
        pendingCount: s.pending.size,
    }, '确认请求已结算')
    // 通知 desktop 弹框关闭 + 所有适配器清除挂起
    broadcastTurn(sessionId, {
        type: 'confirmation_resolved',
        requestId,
        confirmationType: entry.type,
        toolName: entry.toolName,
        decision: result?.behavior || 'unknown',
        wonBy,
        turnId: entry.turnId || null,
    },
        entry.userId ? {source: entry.source, userId: entry.userId} : null)
    for (const hook of confirmHooks) {
        try {
            hook.onConfirmResolved?.(sessionId, requestId)
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
    }
}

// AskUserQuestion 选项标签查找
// 功能说明: 从 AskUserQuestion 的选项中提取指定索引的 label 文本
// 实现方式: 安全索引访问（entry.questions?.[qi]?.options?.[oi]?.label），找不到回退到 String(oi)
// 关键数据流: entry → questions[qi] → options[oi] → .label 或 String(oi)
function labelForChoice(entry, qi, oi) {
    return entry.questions?.[qi]?.options?.[oi]?.label ?? String(oi)
}

// canUseTool 回调工厂：每个 session 一份，挂起 Promise 直到任一通道响应
// ── canUseTool 回调工厂 ──
// 功能说明: 为每个 session 创建一个 SDK canUseTool 回调，当 Claude 要执行工具/询问用户时挂起 Promise
//   等待任意通道（desktop/wechat/feishu/dingtalk）返回确认结果
// 实现方式:
//   1. 生成唯一 requestId，区分 permission（工具权限）和 choice（AskUserQuestion）两种类型
//   2. 创建 entry 对象（含 resolve/settled/timeout），放入 s.pending Map
//   3. 设 5 分钟超时 → 拒绝并中断；监听 abort signal → 取消挂起
//   4. broadcast 给 desktop + 遍历 confirmHooks 推给 mirror 已开启的 IM 适配器
// 关键数据流: SDK tool 调用 → canUseTool(toolName, input) → create entry + push pending
//   → broadcast(desktop) + confirmHooks(IM) → 用户响应 → settlePending() → resolve(decision) → SDK 继续
function makeCanUseTool(sessionId) {
    return (toolName, input, {signal, toolUseID}) => new Promise((resolve) => {
        const s = sessions.get(sessionId)
        if (!s) {
            resolve({behavior: 'deny', message: 'session 已关闭', interrupt: true});
            return
        }
        const requestId = `req-${++reqCounter}`

        // Agent/Task/Workflow 均由 SDK 内部执行，必须先广播生命周期再走权限短路。
        const lifecycleEvent = buildAgentToolLifecycleEvent(
            toolName,
            input,
            requestId,
            Date.now(),
            s.queryOpts?.agents || {},
            {toolUseId: toolUseID},
        )
        if (lifecycleEvent) {
            if (lifecycleEvent.type === 'subagent_spawning') {
                s.pendingAgentSpawns = s.pendingAgentSpawns || []
                s.pendingAgentSpawns.push(lifecycleEvent)
            }
            log.info({
                sessionId: sessionId?.slice(0, 8),
                toolName: lifecycleEvent.agentType,
                task: lifecycleEvent.task || 'no task'
            }, `${toolName} tool`)
            broadcast(sessionId, lifecycleEvent)
            resolve({behavior: 'allow', updatedInput: input})
            return
        }

        // 动态权限: 切换 permissionMode 后下一个普通工具调用立即生效，无需重建 query
        if (s.permissionMode === 'bypassPermissions') {
            resolve({behavior: 'allow', updatedInput: input})
            return
        }

        const isChoice = toolName === 'AskUserQuestion'
        const turnIdentity = s.activeTurnIdentity ? {...s.activeTurnIdentity} : null
        const entry = {
            id: requestId, sessionId, type: isChoice ? 'choice' : 'permission',
            toolName, input, questions: isChoice ? (input?.questions || []) : undefined,
            source: turnIdentity?.source || 'desktop', userId: turnIdentity?.userId || null,
            turnId: s.activeTurnId || null,
            expiresAt: Date.now() + 5 * 60 * 1000,
            resolve, settled: false, timeout: null,
        }
        // 5 分钟超时 → 拒绝并中断
        entry.timeout = setTimeout(() => {
            settlePending(sessionId, requestId, {behavior: 'deny', message: '确认超时', interrupt: true}, 'timeout')
        }, 5 * 60 * 1000)
        // entry 须在 addEventListener 之前写入 pending，防止 signal 已处于 aborted 状态时
        // 回调同步执行却找不到 entry 导致只能等 5 分钟 timeout 清理
        s.pending.set(requestId, entry)
        // query 被中止（stop_generation / abort）→ 拒绝并中断
        if (signal) signal.addEventListener('abort', () => {
            settlePending(sessionId, requestId, {behavior: 'deny', message: '已取消', interrupt: true}, 'abort')
        }, {once: true})
        log.info({sessionId: sessionId?.slice(0, 8), requestId, type: entry.type, toolName}, '确认请求')
        // 推 desktop
        broadcastTurn(sessionId, isChoice
            ? {type: 'choice_request', requestId, toolName, questions: entry.questions, turnId: entry.turnId}
            : {type: 'permission_request', requestId, toolName, input, turnId: entry.turnId}, turnIdentity)
        // 权限确认推给 mirror 已开启的适配器（mirror 开启时由 hook 下发；关闭时适配器走 WS 内联路径）
        for (const hook of confirmHooks) {
            if (!s.mirrors[hook.platform]) continue
            if (!shouldRouteMirror(hook.platform, turnIdentity)) continue
            try {
                hook.onConfirmRequest?.({
                    sessionId,
                    requestId,
                    type: entry.type,
                    toolName,
                    input,
                    questions: entry.questions,
                    userId: turnIdentity?.userId || null,
                })
            } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        }
    })
}

// 决策映射为 SDK PermissionResult
// 功能说明: 将用户的确认决策映射为 SDK PermissionResult 格式
// 实现方式: choice 类型解析 optionIndex/questionIndex 获取标签文本，引导喂回模型但不中断（interrupt:false）
//   permission 类型: allow → 返回 updatedInput；否则 deny + interrupt:false
// 关键数据流: 用户决策(allow/deny/选项索引) → PermissionResult {behavior, message, interrupt, updatedInput?}
function decisionToResult(entry, decision, optionIndex, questionIndex, customText) {
    if (entry.type === 'choice') {
        const label = customText || labelForChoice(entry, questionIndex ?? 0, optionIndex ?? 0)
        // 把用户选择作为引导喂回模型，不中断（spike 后可能改为 allow+updatedInput）
        return {behavior: 'deny', message: `用户选择了: ${label}`, interrupt: false}
    }
    if (decision === 'allow') return {behavior: 'allow', updatedInput: entry.input}
    return {behavior: 'deny', message: '用户拒绝了该操作', interrupt: false}
}

// ---- Helpers ----
// 功能说明: 解析 Markdown 文件中的 YAML frontmatter（---...---），分离元数据和正文
// 实现方式: 正则 ^---\r?\n([\s\S]*?)\r?\n--- 提取 frontmatter 块，逐行 : 分割为键值对
// 关键数据流: markdown 文本 → 正则匹配 → {frontmatter: {key:val}, body: 正文}
function parseFrontmatter(c) {
    const m = c.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {frontmatter: {}, body: c};
    const fm = {};
    for (const l of m[1].split('\n')) {
        const col = l.indexOf(':');
        if (col > 0) fm[l.slice(0, col).trim()] = l.slice(col + 1).trim()
    }
    ;
    return {frontmatter: fm, body: c.slice(m[0].length).trim()}
}

// 功能说明: 安全读取 JSON 文件，解析失败返回 null（不抛异常）
// 实现方式: try { JSON.parse(readFileSync) } catch { null }
// 关键数据流: 文件路径 → readFileSync → JSON.parse → 对象 或 null
function readJSON(p) {
    try {
        return JSON.parse(readFileSync(p, 'utf8'))
    } catch {
        return null
    }
}

function requestPinnedProvider(target, options = {}) {
    const {parsed, address, family} = target
    const transport = parsed.protocol === 'https:' ? httpsRequest : httpRequest
    const requestHeaders = new Headers(options.headers || {})
    // 连接使用已校验的 IP，但 Host/SNI 仍保留供应商域名，避免证书和虚拟主机路由失效。
    requestHeaders.set('host', parsed.host)
    const requestOptions = {
        protocol: parsed.protocol,
        hostname: parsed.hostname.replace(/^\[|\]$/g, ''),
        port: parsed.port || undefined,
        path: `${parsed.pathname || '/'}${parsed.search || ''}`,
        method: options.method || 'GET',
        headers: Object.fromEntries(requestHeaders.entries()),
        lookup: createPinnedLookup(address, family),
        signal: options.signal,
        ...(parsed.protocol === 'https:' ? {servername: parsed.hostname.replace(/^\[|\]$/g, '')} : {}),
    }
    return new Promise((resolve, reject) => {
        const MAX_PROVIDER_RESPONSE_BYTES = 5 * 1024 * 1024
        let settled = false
        const req = transport(requestOptions, (res) => {
            const chunks = []
            let totalBytes = 0
            res.on('data', (chunk) => {
                if (settled) return
                totalBytes += chunk.length
                if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
                    settled = true
                    res.destroy()
                    req.destroy()
                    reject(new Error('provider response too large'))
                    return
                }
                chunks.push(chunk)
            })
            res.on('end', () => {
                if (settled) return
                settled = true
                const headers = new Headers()
                for (const [key, value] of Object.entries(res.headers)) {
                    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item))
                    else if (value != null) headers.set(key, String(value))
                }
                resolve(new Response(Buffer.concat(chunks), {
                    status: res.statusCode || 502,
                    statusText: res.statusMessage || '',
                    headers,
                }))
            })
            res.on('error', error => {
                if (settled) return
                settled = true
                reject(error)
            })
        })
        req.on('error', error => {
            if (settled) return
            settled = true
            reject(error)
        })
        if (options.body != null) req.write(options.body)
        req.end()
    })
}

async function fetchProviderResponse(rawUrl, options = {}) {
    let currentUrl = rawUrl
    const allowedOrigin = new URL(rawUrl).origin
    for (let hop = 0; hop < 4; hop++) {
        // 每一跳都只使用这一次 DNS 解析返回的已校验地址，避免校验后由底层 fetch 再次解析到内网。
        const target = await resolveProviderUrl(currentUrl)
        const response = await requestPinnedProvider(target, options)
        if (response.status < 300 || response.status >= 400) return {response, url: currentUrl}
        const location = response.headers.get('location')
        if (!location) return {response, url: currentUrl}
        currentUrl = resolveProviderRedirect(currentUrl, location, allowedOrigin)
    }
    throw new Error('provider redirect limit exceeded')
}

function getAdapterIdentity(req) {
    const source = req.headers['x-bridge-source']
    const userId = req.headers['x-bridge-user-id']
    if (typeof source !== 'string' || typeof userId !== 'string' || !IM_SOURCES.has(source)
        || !userId || userId.length > 512 || /[\0\r\n]/.test(userId)) return null
    return {source, userId}
}

function adapterRouteAllowed(method, pathname, platform) {
    if (method === 'POST' && ['/api/confirm', '/api/sessions/resolve', '/api/desktop/nudge', '/api/mirror', '/api/sessions-by-label'].includes(pathname)) return true
    if (method === 'GET' && ['/api/sessions/focused', '/api/projects'].includes(pathname)) return true
    if (method === 'GET' && /^\/api\/sessions\/[^/]+\/mirror$/.test(pathname)) return true
    return false
}

function adapterOwnsSession(source, userId, sessionId) {
    const bindings = readAdapterBindings()
    const binding = bindings[`${source}:${userId}`]
    return binding?.platform === source && binding?.userId === userId && binding?.sessionId === sessionId
}

function adapterOwnsFocusedSession(identity) {
    return !!identity && !!focusedSessionId && adapterOwnsSession(identity.source, identity.userId, focusedSessionId)
}

function adapterOwnsProject(identity, encodedDir) {
    if (!identity || typeof encodedDir !== 'string') return false
    const binding = readAdapterBindings()[`${identity.source}:${identity.userId}`]
    return !!binding && encodeProjectName(binding.workDir) === safeDecodeURIComponent(encodedDir)
}

function readAdapterBindings() {
    if (!existsSync(ADAPTER_SESSIONS_PATH)) return {}
    try {
        return normalizeAdapterBindings(JSON.parse(readFileSync(ADAPTER_SESSIONS_PATH, 'utf8')), ADAPTER_PLATFORMS)
    } catch (error) {
        const corruptPath = `${ADAPTER_SESSIONS_PATH}.corrupt-${Date.now()}`
        try {
            renameSync(ADAPTER_SESSIONS_PATH, corruptPath)
            log.error({err: error, corruptPath}, 'IM Session 绑定文件损坏，已隔离并重新建立')
            return {}
        } catch (renameError) {
            throw new AggregateError([error, renameError], 'IM Session 绑定文件损坏且无法隔离')
        }
    }
}

function writeAdapterBindings(bindings) {
    writeJSON(ADAPTER_SESSIONS_PATH, normalizeAdapterBindings(bindings, ADAPTER_PLATFORMS))
}

function isAdapterSessionActive(sessionId) {
    if (sessions.has(sessionId)) return true
    for (const session of sessions.values()) {
        if (session.lastSessionId === sessionId) return true
    }
    return false
}

function clearAdapterBindings(predicate) {
    const result = removeAdapterBindings(readAdapterBindings(), predicate, ADAPTER_PLATFORMS)
    if (result.deleted > 0) writeAdapterBindings(result.bindings)
    return result.deleted
}

function clearAdapterBindingsForSessions(...sessionIds) {
    const ids = new Set(sessionIds.filter(Boolean).map(String))
    if (ids.size === 0) return 0
    return clearAdapterBindings(binding => ids.has(binding.sessionId))
}

// 功能说明: 写入 JSON 文件（格式化缩进 2 空格，原子写入防崩溃损坏）
// 实现方式: JSON.stringify → writeFileSync(tmp) → rename(tmp, p)，避免中途崩溃导致文件损坏
// 关键数据流: 对象 → JSON.stringify → 临时文件 → rename → 目标文件
function writeJSON(p, d) {
    const tmp = p + '.tmp'
    const json = JSON.stringify(d, null, 2)
    mkdirSync(dirname(p), {recursive: true})
    writeFileSync(tmp, json, {encoding: 'utf8', mode: 0o600})
    try {
        renameSync(tmp, p)
    } catch (renameError) {
        // Windows 下 rename 有时因文件锁/权限失败，回退到直接覆盖写
        try {
            writeFileSync(p, json, {encoding: 'utf8', mode: 0o600})
        } catch (writeError) {
            try { unlinkSync(tmp) } catch (cleanupError) {
                log.warn({err: cleanupError, path: tmp}, 'JSON 临时文件清理失败')
            }
            throw new AggregateError([renameError, writeError], `JSON 写入失败: ${p}`)
        }
        try { unlinkSync(tmp) } catch (cleanupError) {
            log.warn({err: cleanupError, path: tmp}, 'JSON 临时文件清理失败')
        }
    }
}

// 功能说明: 写入前备份原文件到 .bak 后缀
// 实现方式: 先 readFileSync 再 writeFileSync(p + '.bak')
// 关键数据流: 源文件 → 复制到 .bak
function backupFile(p) {
    try {
        writeFileSync(p + '.bak', readFileSync(p))
    } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
}

// 功能说明: 加载 ~/.claude-desktop-bridge/settings.json 配置文件，不存在则返回 {}
// 实现方式: readJSON 封装 JSON.parse + readFileSync + try/catch，失败返回 null → || {} 兜底
// 关键数据流: ~/.claude-desktop-bridge/settings.json → readFileSync → JSON.parse → 配置对象 或 {}
function loadBridgeProviderSettings() {
    const stored = readJSON(BRIDGE_PROVIDER_SETTINGS_PATH)
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        return normalizeBridgeProviderSettings(stored)
    }
    // 首次隔离时只使用 Bridge 自己的 gateway/.env；正式包没有 .env 时使用无密钥默认值。
    // 绝不从 settings.json 迁移 CCSwitch 的本地代理地址或 token。
    return normalizeBridgeProviderSettings({
        model: process.env.ANTHROPIC_MODEL || MODEL,
        env: {
            ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || 'https://api.deepseek.com/anthropic',
            ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY,
        },
    })
}

function saveBridgeProviderSettings(settings) {
    const normalized = normalizeBridgeProviderSettings(settings)
    mkdirSync(BRIDGE_HOME, {recursive: true})
    writeJSON(BRIDGE_PROVIDER_SETTINGS_PATH, normalized)
    return normalized
}

function loadCliSettings() {
    const raw = readJSON(join(BRIDGE_HOME, 'settings.json')) || {}
    return overlayBridgeProviderSettings(raw, loadBridgeProviderSettings())
}

function loadCliSettingsForUpdate() {
    const settingsPath = join(BRIDGE_HOME, 'settings.json')
    if (!existsSync(settingsPath)) return {}
    const value = JSON.parse(readFileSync(settingsPath, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('settings.json 内容无效，已拒绝覆盖原文件')
    }
    return value
}

// ── Hook 脚本存在性审计 ──
// 启动时只记录明显缺失的脚本。Gateway 不应在用户未确认时改写全局 settings.json。
function validateHooks() {
    const sp = join(BRIDGE_HOME, 'settings.json')
    const s = readJSON(sp)
    if (!s || !s.hooks || typeof s.hooks !== 'object') return

    const hooksDir = join(BRIDGE_HOME, 'hooks')

    for (const [eventType, entries] of Object.entries(s.hooks)) {
        if (!Array.isArray(entries)) continue
        for (const entry of entries) {
            for (const h of (entry.hooks || [])) {
                if (h.type !== 'command') continue
                const cmd = h.command || ''
                const rawLastArg = cmd.match(/(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/)
                const scriptFile = basename(rawLastArg?.[1] || rawLastArg?.[2] || rawLastArg?.[3] || '')
                if (!scriptFile || !/\.(sh|js|mjs|cjs|ps1)$/i.test(scriptFile)) continue
                const scriptPath = safeBasename(hooksDir, scriptFile, {extensions: ['.sh', '.js', '.mjs', '.cjs', '.ps1']})
                if (scriptPath && !existsSync(scriptPath)) {
                    log.warn({eventType, script: scriptFile}, 'Hook 脚本缺失，请在设置页确认或修复')
                }
            }
        }
    }
}

// workflow 全局开关
const WF_CONFIG_FILE = join(BRIDGE_HOME, 'bridge-workflow.json')

function loadWfConfig() {
    return {enabled: false, journalCacheTTL: 30,
        modelTiers: {power: null, balanced: null, light: null},
        ...(readJSON(WF_CONFIG_FILE) || {})}
}

function saveWfConfig(c) {
    writeJSON(WF_CONFIG_FILE, c)
}

// ── Caveman skill 内置安装 + 配置 ──
// 功能说明: 确保 ~/.claude-desktop-bridge/skills/caveman/SKILL.md 存在，不存在则从内置模板写入
//   配置存 settings.json → caveman: {enabled, level}，默认开启 full 级别
// SIDE_EFFECT: 写入 ~/.claude-desktop-bridge/skills/caveman/SKILL.md（首次）
const CAVEMAN_SKILL_DIR = join(BRIDGE_HOME, 'skills', 'caveman')
const CAVEMAN_SKILL_FILE = join(CAVEMAN_SKILL_DIR, 'SKILL.md')
const CAVEMAN_VERSION_FILE = join(CAVEMAN_SKILL_DIR, 'VERSION')
const CAVEMAN_DEFAULT_CONFIG = {enabled: true, level: 'full'}
const CAVEMAN_VALID_LEVELS = ['lite', 'full', 'ultra', 'wenyan']

// ── 语义化版本号提取（从 v0.43.0 / dev-0.43.0-rc.292 等标签中提取 [major, minor, patch]）──
function extractSemver(tag) {
    const m = tag.match(/(\d+)\.(\d+)\.(\d+)/)
    if (!m) return null
    return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])]
}
function compareSemver(a, b) {
    if (!a && !b) return 0
    if (!a) return -1  // 无法解析视为旧版本
    if (!b) return 1
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] - b[i]
    }
    return 0
}

// ── Caveman 版本检查（启动时调 GitHub API）──
async function checkCavemanUpdate() {
    let current = 'builtin'
    try {
        if (existsSync(CAVEMAN_VERSION_FILE)) current = readFileSync(CAVEMAN_VERSION_FILE, 'utf8').trim()
    } catch (error) {
        log.debug({err: error, path: CAVEMAN_VERSION_FILE}, '读取 Caveman 版本文件失败')
    }
    dynamicCache.cavemanCurrent = current
    try {
        const resp = await fetch('https://api.github.com/repos/JuliusBrussee/caveman/releases?per_page=5', {
            signal: AbortSignal.timeout(30000)
        })
        if (!resp.ok) { log.warn({status: resp.status}, 'Caveman releases 获取失败'); return }
        const releases = await resp.json()
        if (!Array.isArray(releases) || !releases.length) return
        const latest = releases[0].tag_name || ''
        dynamicCache.cavemanReleases = releases.map(r => ({
            tag: r.tag_name,
            name: r.name || r.tag_name,
            publishedAt: r.published_at,
        }))
        const curSemver = extractSemver(current)
        if (latest && compareSemver(curSemver, extractSemver(latest)) < 0) {
            dynamicCache.cavemanUpdate = {current, latest, checkedAt: new Date().toISOString()}
            log.info({current, latest}, 'Caveman 有新版本可用')
        } else {
            dynamicCache.cavemanUpdate = null  // 清除旧缓存，避免残留更新提示
        }
        persistDynamicCache()
    } catch (e) {
        log.info({err: e}, 'Caveman 版本检查网络异常（非关键）')
    }
}

// ── Caveman SKILL.md 更新（下载指定版本替换）──
async function downloadAndReplaceCaveman(targetVersion) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(targetVersion)) throw new Error('Caveman 版本号格式不合法')
    const skillUrl = `https://raw.githubusercontent.com/JuliusBrussee/caveman/${targetVersion}/skills/caveman/SKILL.md`
    log.info({version: targetVersion, url: skillUrl}, 'Caveman 开始下载')
    const resp = await fetch(skillUrl, {signal: AbortSignal.timeout(30000)})
    if (!resp.ok) throw new Error(`下载失败 ${resp.status}`)
    const content = (await readFetchBodyLimited(resp, MAX_REMOTE_TEXT_BYTES)).toString('utf8')
    if (!content.trim()) throw new Error('下载内容为空')
    mkdirSync(CAVEMAN_SKILL_DIR, {recursive: true})
    // 备份旧文件
    if (existsSync(CAVEMAN_SKILL_FILE)) {
        writeFileSync(CAVEMAN_SKILL_FILE + '.bak', readFileSync(CAVEMAN_SKILL_FILE, 'utf8'), 'utf8')
    }
    writeFileSync(CAVEMAN_SKILL_FILE, content, 'utf8')
    writeFileSync(CAVEMAN_VERSION_FILE, targetVersion, 'utf8')
    dynamicCache.cavemanCurrent = targetVersion
    dynamicCache.cavemanUpdate = null
    persistDynamicCache()
    log.info({version: targetVersion}, 'Caveman 更新完成')
}

function loadCavemanConfig() {
    const s = readJSON(join(BRIDGE_HOME, 'settings.json')) || {}
    const c = s.caveman
    if (c && typeof c === 'object' && typeof c.enabled === 'boolean' && CAVEMAN_VALID_LEVELS.includes(c.level)) {
        return c
    }
    return {...CAVEMAN_DEFAULT_CONFIG}
}

function saveCavemanConfig(cfg) {
    const s = loadCliSettingsForUpdate()
    s.caveman = cfg
    writeJSON(join(BRIDGE_HOME, 'settings.json'), s)
}

// ── Caveman 系统提示词生成（会话级 systemPrompt.append 注入，不污染任何 CLAUDE.md）──
function buildCavemanSystemPrompt(cfg) {
    if (!cfg || !cfg.enabled || !cfg.level) return null
    const base = 'Use caveman compression (level: ' + cfg.level + '): drop filler/hedging/articles, use fragments and short synonyms. Keep all technical substance, code, error strings exact. No emoji, no tool-call narration. Speak user\'s language. Resume normal style for security warnings and destructive actions.'
    if (cfg.level === 'wenyan' || cfg.level.startsWith('wenyan')) {
        return base + ' Use classical Chinese (文言文) style.'
    }
    return base
}

// ── RTK 二进制定位 + 版本检查 + 配置 ──
// 功能说明: rtk（MIT）是 Rust 命令行压缩工具，bridge 打包内置，PostToolUse hook 调用
//   开发环境从 ../rtk-bin/ 找；生产环境从 process.resourcesPath/rtk/ 找
//   配置存 settings.json → bashCompress: {enabled}
//   版本检查: 启动时调 GitHub API 对比本地 version.txt，有更新写入 dynamicCache 供前端显示
// SIDE_EFFECT: 启动时调 GitHub API（checkRtkUpdate）→ 写入 dynamicCache.rtkUpdate → persistDynamicCache()
const RTK_TIMEOUT = 5000  // rtk 进程超时（ms）
const RTK_REJECT_RATIO = 0.95  // 压缩比 > 95% → 驳回
const RTK_CRITICAL_PATTERN = /fatal|panic|denied|segfault|corruption/i  // 致命关键词
const MAX_RTK_ARCHIVE_BYTES = 100 * 1024 * 1024
const MAX_REMOTE_TEXT_BYTES = 2 * 1024 * 1024

async function readFetchBodyLimited(response, maxBytes) {
    const declared = Number(response.headers.get('content-length') || 0)
    if (Number.isFinite(declared) && declared > maxBytes) {
        try { await response.body?.cancel() } catch (cancelError) {
            log.debug({err: cancelError}, '取消声明长度超限的下载流失败')
        }
        throw new Error('下载文件超过大小限制')
    }
    if (!response.body) return Buffer.alloc(0)
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    try {
        while (true) {
            const {done, value} = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > maxBytes) throw new Error('下载文件超过大小限制')
            chunks.push(Buffer.from(value))
        }
    } catch (error) {
        try { await reader.cancel(error) } catch (cancelError) {
            log.debug({err: cancelError}, '取消超限下载流失败')
        }
        throw error
    } finally {
        reader.releaseLock()
    }
    return Buffer.concat(chunks, total)
}

function locateRtk() {
    const plat = process.platform
    const arch = process.arch
    const map = {
        'win32-x64': 'rtk-x86_64-pc-windows-msvc.exe',
        'linux-x64': 'rtk-x86_64-unknown-linux-gnu',
        'darwin-x64': 'rtk-x86_64-apple-darwin',
        'darwin-arm64': 'rtk-aarch64-apple-darwin',
    }
    const name = map[`${plat}-${arch}`]
    if (!name) return null
    // rtk 在 gateway 同级目录：开发 rtk-bin/，生产打包 rtk/（extraResources.to）
    for (const dir of ['rtk-bin', 'rtk']) {
        const p = resolve(__dirname, '..', dir, name)
        if (existsSync(p)) return p
    }
    return null
}

function getRtkDir() {
    for (const dir of ['rtk-bin', 'rtk']) {
        const d = resolve(__dirname, '..', dir)
        if (existsSync(d)) return d
    }
    return resolve(__dirname, '..', 'rtk-bin')  // 默认，后续创建
}

function loadRtkConfig() {
    const s = readJSON(join(BRIDGE_HOME, 'settings.json')) || {}
    const c = s.bashCompress
    if (c && typeof c === 'object' && typeof c.enabled === 'boolean') return c
    return {enabled: true}
}

function saveRtkConfig(cfg) {
    const s = loadCliSettingsForUpdate()
    s.bashCompress = cfg
    writeJSON(join(BRIDGE_HOME, 'settings.json'), s)
}

async function checkRtkUpdate() {
    const rtkDir = getRtkDir()
    const versionFile = join(rtkDir, 'version.txt')
    let current = 'unknown'
    try {
        if (existsSync(versionFile)) current = readFileSync(versionFile, 'utf8').trim()
    } catch (error) {
        log.debug({err: error, path: versionFile}, '读取 RTK 版本文件失败')
    }
    // 持久化当前版本号供前端显示
    dynamicCache.rtkCurrent = current
    try {
        const resp = await fetch('https://api.github.com/repos/rtk-ai/rtk/releases?per_page=5', {
            signal: AbortSignal.timeout(30000)
        })
        if (!resp.ok) { log.warn({status: resp.status}, 'RTK releases 获取失败'); return }
        const releases = await resp.json()
        if (!Array.isArray(releases) || !releases.length) return
        const latest = releases[0].tag_name || ''
        // 缓存可用版本列表供前端选择（保留全部版本）
        dynamicCache.rtkReleases = releases.map(r => ({
            tag: r.tag_name,
            name: r.name || r.tag_name,
            publishedAt: r.published_at,
        }))
        const rtkSemver = extractSemver(current)
        if (latest && compareSemver(rtkSemver, extractSemver(latest)) < 0) {
            dynamicCache.rtkUpdate = {current, latest, checkedAt: new Date().toISOString()}
            log.info({current, latest}, 'RTK 有新版本可用')
        } else {
            dynamicCache.rtkUpdate = null  // 清除旧缓存，避免残留更新提示
        }
        persistDynamicCache()
    } catch (e) {
        log.info({err: e}, 'RTK 版本检查网络异常（非关键）')
    }
}

// ── RTK 二进制更新（下载 + 替换）──
// 功能说明: 从 GitHub 下载指定版本的 RTK 二进制，解压替换本地文件，更新 version.txt
//   仅支持 Windows (.zip) 和 Linux/macOS (.tar.gz)
// SIDE_EFFECT: 覆盖 rtk-bin/ 或 resources/rtk/ 下的二进制 + version.txt
async function downloadAndReplaceRtk(targetVersion) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(targetVersion)) throw new Error('RTK 版本号格式不合法')
    const plat = process.platform
    const arch = process.arch
    const binName = {
        'win32-x64': 'rtk-x86_64-pc-windows-msvc.exe',
        'linux-x64': 'rtk-x86_64-unknown-linux-gnu',
        'darwin-x64': 'rtk-x86_64-apple-darwin',
        'darwin-arm64': 'rtk-aarch64-apple-darwin',
    }[`${plat}-${arch}`]
    if (!binName) throw new Error(`不支持的平台: ${plat}-${arch}`)

    const rtkDir = getRtkDir()
    mkdirSync(rtkDir, {recursive: true})

    // 1. 获取 release 详情找到下载 URL
    const releaseResp = await fetch(`https://api.github.com/repos/rtk-ai/rtk/releases/tags/${targetVersion}`, {
        signal: AbortSignal.timeout(30000)
    })
    if (!releaseResp.ok) throw new Error(`GitHub API 返回 ${releaseResp.status}`)
    const release = await releaseResp.json()
    const asset = selectRtkReleaseAsset(release.assets, binName, plat)
    const downloadUrl = asset.browser_download_url
    // 校验下载 URL 必须是 GitHub 域名（防止 GitHub API 响应被污染时 SSRF）
    let parsedDownloadUrl
    try { parsedDownloadUrl = new URL(downloadUrl) } catch { throw new Error('RTK 下载链接格式不合法') }
    if (parsedDownloadUrl.protocol !== 'https:' || parsedDownloadUrl.hostname.toLowerCase() !== 'github.com') {
        throw new Error('RTK 下载链接域名不合法')
    }

    // 2. 下载到临时文件
    log.info({version: targetVersion, url: downloadUrl}, 'RTK 开始下载')
    const tmpFile = join(rtkDir, `_rtk_download${plat === 'win32' ? '.zip' : '.tar.gz'}`)
    const dlResp = await fetch(downloadUrl, {signal: AbortSignal.timeout(120000)})
    if (!dlResp.ok) throw new Error(`下载失败 ${dlResp.status}`)
    const buf = await readFetchBodyLimited(dlResp, MAX_RTK_ARCHIVE_BYTES)
    const digest = verifyRtkAssetDigest(buf, asset.digest)
    writeFileSync(tmpFile, buf)
    log.info({version: targetVersion, size: buf.length, sha256: digest}, 'RTK 下载完成并通过哈希校验')

    // 3. 解压
    const dest = join(rtkDir, binName)
    const pendingDest = dest + '.new'
    const backupDest = dest + '.bak'
    try {
        if (existsSync(pendingDest)) unlinkSync(pendingDest)
        if (plat === 'win32') {
            const psResult = spawnSync('powershell.exe', buildWindowsRtkExtractArgs(), {
                timeout: 30000,
                windowsHide: true,
                env: buildWindowsRtkExtractEnv(tmpFile, pendingDest),
            })
            if (psResult.error) throw new Error(`解压失败: ${psResult.error.message}`)
            if (psResult.status !== 0 || !existsSync(pendingDest)) throw new Error('解压后未找到 rtk.exe')
        } else {
            const listResult = spawnSync('tar', ['-tzf', tmpFile], {
                timeout: 30000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
            })
            if (listResult.error || listResult.status !== 0) {
                throw new Error(`读取归档目录失败: ${listResult.error?.message || listResult.stderr || listResult.status}`)
            }
            const entries = listResult.stdout.split(/\r?\n/).filter(Boolean)
            if (entries.some(entry => entry.startsWith('/') || entry.split('/').some(segment => segment === '..'))) {
                throw new Error('RTK 归档包含非法路径')
            }
            const binaryEntry = entries.find(entry => entry.split('/').pop() === binName)
            if (!binaryEntry) throw new Error(`归档中未找到 ${binName}`)
            const extractResult = spawnSync('tar', ['-xOzf', tmpFile, binaryEntry], {
                timeout: 30000, encoding: null, maxBuffer: MAX_RTK_ARCHIVE_BYTES,
            })
            if (extractResult.error || extractResult.status !== 0 || !extractResult.stdout?.length) {
                throw new Error(`提取二进制失败: ${extractResult.error?.message || extractResult.stderr?.toString() || extractResult.status}`)
            }
            writeFileSync(pendingDest, extractResult.stdout)
        }
        if (plat !== 'win32') {
            const chmodResult = spawnSync('chmod', ['+x', pendingDest], {timeout: 5000})
            if (chmodResult.error || chmodResult.status !== 0) throw new Error('设置 RTK 可执行权限失败')
        }
        if (existsSync(backupDest)) unlinkSync(backupDest)
        if (existsSync(dest)) renameSync(dest, backupDest)
        try {
            renameSync(pendingDest, dest)
        } catch (error) {
            if (existsSync(backupDest) && !existsSync(dest)) renameSync(backupDest, dest)
            throw error
        }
        if (existsSync(backupDest)) unlinkSync(backupDest)
    } finally {
        if (existsSync(tmpFile)) unlinkSync(tmpFile)
        if (existsSync(pendingDest)) unlinkSync(pendingDest)
    }

    // 4. 更新 version.txt
    writeFileSync(join(rtkDir, 'version.txt'), targetVersion, 'utf8')
    dynamicCache.rtkCurrent = targetVersion

    // 5. 清除更新提示（版本列表保留，供后续切换）
    dynamicCache.rtkUpdate = null
    persistDynamicCache()
    log.info({version: targetVersion}, 'RTK 更新完成')
}

// ── RTK PostToolUse hook 处理器 ──
// 功能说明: 拦截 Bash 工具的结果，将 stdout 通过 rtk pipe 管道压缩后替换 tool_response
//   含两道安全检查：压缩比异常 → 驳回；致命关键词漏网 → 驳回
//   失败/超时/不可用 → 静默降级，原样返回
// 实现方式: spawn rtk pipe → stdin 写入 stdout 原文 → 收集输出 → 检查 → updatedMCPToolOutput
// 关键数据流: tool_response → spawn rtk pipe → 压缩结果 → 安全检查 → {continue: true, hookSpecificOutput}
//   或 驳回/降级 → {continue: true}（不修改 tool_response）
async function rtkPostToolUseHandler(input, _toolUseID, _options) {
    const rtkPath = locateRtk()
    if (!rtkPath) return {continue: true}
    const cfg = loadRtkConfig()
    if (!cfg.enabled) return {continue: true}
    if (input.tool_name !== 'Bash') return {continue: true}

    const response = input.tool_response
    // 判断是否为结构化结果（SDK 返回 {stdout, stderr, exitCode, ...}），非结构化则跳过
    if (!response || typeof response !== 'object') return {continue: true}
    const {stdout, stderr, exitCode} = response
    const original = (stdout || '') + (stderr ? '\n' + stderr : '')
    if (!original.trim()) return {continue: true}
    // exitCode ≠ 0 → 失败命令不压缩
    if (exitCode !== undefined && exitCode !== 0) return {continue: true}

    // 获取原命令文本（从 tool_input 中取）
    const cmd = (input.tool_input && typeof input.tool_input === 'object' && input.tool_input.command)
        ? String(input.tool_input.command)
        : ''

    // RTK 会重新执行命令来获取压缩输出，仅对只读命令安全
    if (!isReadOnlyCommand(cmd)) return {continue: true}

    // 调用 rtk 压缩
    let compressed = null
    try {
        compressed = await spawnRtk(rtkPath, cmd, original)
    } catch (e) {
        log.warn({err: e, sessionId: input.session_id?.slice(0, 8)}, 'RTK 压缩失败，降级为原样')
        return {continue: true}
    }
    if (!compressed) return {continue: true}

    // ── bridge 安全检查层 ──
    const originalLen = Buffer.byteLength(original, 'utf8')
    const compressedLen = Buffer.byteLength(compressed, 'utf8')
    // 检查1: 压缩比异常（砍掉 95%+）
    if (originalLen > 0 && (compressedLen / originalLen) < (1 - RTK_REJECT_RATIO)) {
        log.warn({sessionId: input.session_id?.slice(0, 8), originalLen, compressedLen,
            ratio: (compressedLen / originalLen).toFixed(3)}, 'RTK 压缩比异常，驳回')
        return {continue: true}
    }
    // 检查2: 致命关键词漏网（被删除部分含致命关键词）
    if (RTK_CRITICAL_PATTERN.test(original) && !RTK_CRITICAL_PATTERN.test(compressed)) {
        log.warn({sessionId: input.session_id?.slice(0, 8)}, 'RTK 丢弃部分含致命关键词，驳回')
        return {continue: true}
    }

    const savedPct = originalLen > 0 ? Math.round((1 - compressedLen / originalLen) * 100) : 0
    log.info({sessionId: input.session_id?.slice(0, 8), originalLen, compressedLen, savedPct},
        `RTK 压缩 — ${originalLen}→${compressedLen} 字节 节省${savedPct}%`)

    return {
        continue: true,
        hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            updatedMCPToolOutput: {...response, stdout: compressed, stderr: ''}
        }
    }
}

// ── 启动 rtk 子进程并收集输出 ──
// 功能说明: spawn rtk，stdin 传入要压缩的文本，收集 stdout 返回压缩结果
// 实现方式: child_process.spawn → stdin.write + stdin.end → 拼接 stdout chunks
//   5 秒超时，任何异常（崩溃/超时/spawn 失败）抛给调用方
// ── parseShellArgs — 将 shell 命令字符串拆分为 argv 数组 ──
// 处理引号、转义；忽略管道和重定向之后的部分
function parseShellArgs(cmd) {
    const args = []
    let cur = ''
    let quote = ''
    for (let i = 0; i < cmd.length; i++) {
        const ch = cmd[i]
        if (quote) {
            if (ch === '\\' && quote === '"' && i + 1 < cmd.length) {
                cur += cmd[++i]
            } else if (ch === quote) {
                quote = ''
            } else {
                cur += ch
            }
        } else if (ch === '"' || ch === "'") {
            quote = ch
        } else if (ch === ' ' || ch === '\t') {
            if (cur) { args.push(cur); cur = '' }
        } else if (ch === '|' || ch === '>' || ch === '&') {
            // 管道/重定向/后台: 截断后续
            if (cur) args.push(cur)
            return args
        } else {
            cur += ch
        }
    }
    if (cur) args.push(cur)
    return args
}

// ── RTK 安全: 只读命令白名单，防止重执行时产生副作用 ──
// 按平台拆分：Windows 仅包含原生支持 + 跨平台工具，Unix 额外包含 Unix-only 命令
const RTK_READONLY_CROSS = [
    'echo', 'dir', 'tree', 'hostname', 'whoami',
    'git log', 'git diff', 'git show', 'git status', 'git branch', 'git tag',
    'git stash list', 'git remote', 'git config',
    'node -e', 'node -p', 'python -c',
    'npm view', 'npm list', 'npm ls', 'npm outdated',
    'dotnet --list', 'dotnet --info', 'cargo search', 'cargo tree',
    'npx --help', 'npx -v', 'rg',
]
const RTK_READONLY_UNIX = [
    'wc', 'grep', 'ls', 'cat', 'head', 'tail', 'uniq', 'cut', 'tr',
    'awk', 'sed', 'printf', 'env', 'printenv', 'pwd', 'uname', 'which',
    'file', 'stat', 'du', 'df', 'read', 'type', 'find', 'sort', 'date',
]
// Windows: 仅跨平台；Unix: 跨平台 + Unix-only
const RTK_READONLY_PREFIXES = process.platform === 'win32'
    ? RTK_READONLY_CROSS
    : [...RTK_READONLY_CROSS, ...RTK_READONLY_UNIX]

function isReadOnlyCommand(cmd) {
    if (!cmd || typeof cmd !== 'string') return false
    const lower = cmd.trim().toLowerCase()
    for (const prefix of RTK_READONLY_PREFIXES) {
        if (lower.startsWith(prefix)) return true
    }
    return false
}

// ── findGitBashDirs — 动态探测 Windows 上 Git Bash 的 bin 目录 ──
// 用 where.exe git 定位 git.exe，反向推导 /usr/bin；失败则回退常见路径
function findGitBashDirs() {
    const dirs = []
    try {
        const result = spawnSync('where', ['git'], {timeout: 3000, encoding: 'utf8', windowsHide: true})
        if (result.status === 0 && result.stdout) {
            const seen = new Set()
            for (const line of result.stdout.trim().split('\n')) {
                const gitExe = line.trim()
                if (!gitExe || seen.has(gitExe)) continue
                seen.add(gitExe)
                // Git for Windows 标准布局: <GitRoot>/cmd/git.exe → ../usr/bin
                const usrBin = resolve(dirname(gitExe), '..', 'usr', 'bin')
                try {
                    if (statSync(usrBin).isDirectory()) dirs.push(usrBin)
                } catch (error) {
                    if (error?.code !== 'ENOENT') log.debug({err: error, path: usrBin}, '检查 Git Bash usr/bin 失败')
                }
                // 也加入 git.exe 自身目录（部分命令如 git 本身在此）
                const binDir = dirname(gitExe)
                try {
                    if (statSync(binDir).isDirectory() && !dirs.includes(binDir)) dirs.push(binDir)
                } catch (error) {
                    if (error?.code !== 'ENOENT') log.debug({err: error, path: binDir}, '检查 Git 可执行目录失败')
                }
            }
        }
    } catch (error) {
        log.debug({err: error}, '动态探测 Git Bash 目录失败')
    }
    // 动态探测失败 → 回退常见路径兜底
    if (dirs.length === 0) {
        const fallbacks = [
            'C:\\Program Files\\Git\\usr\\bin',
            'C:\\Program Files\\Git\\bin',
            'C:\\Program Files (x86)\\Git\\usr\\bin',
            'C:\\Program Files (x86)\\Git\\bin',
            join(homedir(), 'scoop', 'apps', 'git', 'current', 'usr', 'bin'),
        ]
        for (const d of fallbacks) {
            try {
                if (statSync(d).isDirectory()) dirs.push(d)
            } catch (error) {
                if (error?.code !== 'ENOENT') log.debug({err: error, path: d}, '检查 Git Bash 回退目录失败')
            }
        }
    }
    return dirs
}

// ── spawnRtk — 启动 RTK 子进程处理文本压缩 ──
// 功能说明: 拆分 shell 命令为 argv 传参 RTK，由 RTK 执行原生命令并压缩输出
//   用于 Bash 命令输出压缩（减少 token 消耗）和解压（还原原始输出）
// 实现方式: parseShellArgs(cmd) → child_process.spawn(rtkPath, argv) → 监听 stdout/stderr/close
//   exit code 非 0 时 reject 并携带 stderr 前 200 字符用于诊断
// @param {string} rtkPath - RTK 可执行文件绝对路径
// @param {string} cmd - 原始 shell 命令（拆分为 argv 传入 RTK）
// @param {string} _text - 已废弃（RTK 子命令自行执行，不从 stdin 读取）
// @returns {Promise<string>} stdout 输出
function spawnRtk(rtkPath, cmd, _text) {
    return new Promise((resolve, reject) => {
        const parsedArgs = cmd ? parseShellArgs(cmd) : []
        const args = resolveRtkCommandArgs(parsedArgs)
        if (args.length === 0) { resolve(''); return }
        // Windows 上 rtk 子进程需要 Unix 命令 → 动态探测 Git Bash 的 bin 目录合并到 PATH
        const env = {...process.env}
        if (process.platform === 'win32') {
            const gitBashDirs = findGitBashDirs()
            const existing = (env.PATH || '').split(';')
            for (const d of gitBashDirs) {
                try {
                    if (statSync(d).isDirectory() && !existing.includes(d)) existing.push(d)
                } catch (error) {
                    if (error?.code !== 'ENOENT') log.debug({err: error, path: d}, '合并 RTK PATH 失败')
                }
            }
            env.PATH = existing.join(';')
        }
        const child = spawn(rtkPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: RTK_TIMEOUT,
            windowsHide: true,
            env,
        })
        let stdout = ''
        let stderr = ''
        let settled = false
        const finish = (err, result) => {
            if (settled) return
            settled = true
            // 清理 listener，防止 MaxListeners 累积
            child.stdout.removeAllListeners('data')
            child.stderr.removeAllListeners('data')
            child.removeAllListeners('close')
            child.removeAllListeners('error')
            if (err) reject(err); else resolve(result)
        }
        child.stdout.on('data', (d) => { stdout += d.toString() })
        child.stderr.on('data', (d) => { stderr += d.toString() })
        child.once('close', (code) => {
            if (code !== 0 && code !== null) {
                finish(new Error(`rtk exit ${code}: ${stderr.slice(0, 200)}`))
                return
            }
            finish(null, stdout)
        })
        child.once('error', (e) => finish(e))
        // RTK 子命令自己执行原生命令，不需要 stdin 输入
        child.stdin.end()
    })
}

// 功能说明: 扫描 ~/.claude-desktop-bridge/agents/*.md，解析 frontmatter 组装为 SDK AgentDefinition 字典
// key 为 agent name（frontmatter.name 或文件名去扩展名），value 含 description/tools/model/prompt
// 关键数据流: agents/ 目录 → 遍历 .md → parseFrontmatter → {name: AgentDefinition}
function loadAgentDefinitions() {
    const ad = join(BRIDGE_HOME, 'agents');
    const defs = {}
    try {
        for (const fn of readdirSync(ad)) {
            if (!fn.endsWith('.md')) continue
            try {
                const c = readFileSync(join(ad, fn), 'utf8')
                const {frontmatter: fm, body} = parseFrontmatter(c)
                const name = fm.name || fn.replace(/\.md$/, '')
                const tools = fm.tools ? fm.tools.split(',').map(t => t.trim()).filter(Boolean) : undefined
                defs[name] = {
                    description: fm.description || `Agent: ${name}`,
                    prompt: body?.trim() || fm.description || `You are the "${name}" specialized agent.`,
                    ...(tools ? {tools} : {}),
                    ...(fm.model && fm.model !== 'inherit' ? {model: fm.model} : {}),
                }
            } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        }
    } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
    return defs
}

// 功能说明: 将存储用的编码目录名还原为真实路径（C--Users-xxx → C:/Users/xxx）
// 实现方式: 正则 ^([a-zA-Z])--(.+)$ 提取盘符和后段，后段 - 替换为 /
// 关键数据流: "C--Users-xxx" → 盘符 "C" + 路径段 → "C:/Users/xxx"
function decodeProjectName(n) {
    const m = n.match(/^([a-zA-Z])--(.+)$/);
    if (!m) return null;
    return m[1] + ':/' + m[2].replace(/-/g, '/')
}

// 路径规范化：消除编码歧义，确保相同物理路径产生相同编码结果
//   D:\a\b → D:/a/b，D://a//b → D:/a/b，D:/a/b/ → D:/a/b
function normalizeWorkDir(wd) {
    if (typeof wd !== 'string') return ''
    const raw = wd.trim()
    if (!raw) return ''
    const slashPath = raw.replace(/\\/g, '/')
    const isUnc = slashPath.startsWith('//')
    let normalized = slashPath.replace(/\/+/g, '/')
    if (isUnc) normalized = `//${normalized.replace(/^\/+/, '')}`
    if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) return normalized
    return normalized.replace(/\/+$/, '')
}

// 功能说明: 将工作目录路径编码为文件系统安全的目录名
// 实现方式: 盘符 D:/path/to → "D--path-to"（: → --, / → -）
// 关键数据流: "D:/path/to/project" → "D--path-to-project"
function encodeProjectName(wd) {
    const n = normalizeWorkDir(wd);
    const dm = n.match(/^([a-zA-Z]):\/(.*)$/);
    if (!dm) return n.replace(/\//g, '-');
    return dm[1] + '--' + dm[2].replace(/\//g, '-')
}

// 功能说明: 从 HTTP 请求流中读取完整 body 并解析为 JSON 对象
// 实现方式: 按字节累计 Buffer，超过 10MB 后停止缓存并排空请求；end 时 JSON.parse
// 关键数据流: req stream → Buffer[] → UTF-8 JSON.parse → 对象或显式错误标记
function readBody(req) {
    return new Promise(resolve => {
        const chunks = []
        let totalBytes = 0
        let settled = false
        const cleanup = () => {
            req.removeListener('data', onData)
            req.removeListener('end', onEnd)
            req.removeListener('error', onError)
            req.removeListener('aborted', onAborted)
        }
        const settle = value => {
            if (settled) return
            settled = true
            cleanup()
            resolve(value)
        }
        const onData = c => {
            totalBytes += c.length
            if (totalBytes > 10_000_000) {  // 10MB 字节上限，防止 OOM
                req.resume()
                settle({_bodyTooLarge: true})
                return
            }
            chunks.push(c)
        }
        req.on('data', onData)
        const onEnd = () => {
            try {
                settle(JSON.parse(chunks.length ? Buffer.concat(chunks).toString('utf8') : '{}'))
            } catch {
                settle({_parseError: true})
            }
        }
        const onError = () => settle({_bodyError: true})
        const onAborted = () => settle({_bodyError: true})
        req.on('end', onEnd)
        req.on('error', onError)
        req.on('aborted', onAborted)
    })
}

// 功能说明: 解析 multipart/form-data 上传请求，提取 fields 和 files
// 实现方式: 从 Content-Type 取 boundary → 按 boundary 分割 buffer → 逐个解析 part → 区分字段/文件
// 关键数据流: req stream → Buffer 拼接 → boundary 分割 → {fields, files}
function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const chunks = []
        const MAX_UPLOAD_FILE = 8 * 1024 * 1024
        const MAX_MULTIPART = 10_000_000  // 10MB 上限，与 readBody 一致
        let totalLen = 0
        let settled = false
        const cleanup = () => {
            req.removeListener('data', onData)
            req.removeListener('end', onEnd)
            req.removeListener('error', onError)
            req.removeListener('aborted', onAborted)
        }
        const settleResolve = value => {
            if (settled) return
            settled = true
            cleanup()
            resolve(value)
        }
        const settleReject = error => {
            if (settled) return
            settled = true
            cleanup()
            reject(error)
        }
        const onData = (c) => {
            totalLen += c.length
            if (totalLen > MAX_MULTIPART) {
                req.resume()
                settleReject(new Error('upload too large'))
                return
            }
            chunks.push(c)
        }
        req.on('data', onData)
        const onEnd = () => {
            try {
                const buf = Buffer.concat(chunks)
                const ct = req.headers['content-type'] || ''
                const bm = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/)
                if (!bm) { settleResolve({fields: {}, files: {}}); return }
                const boundary = bm[1] || bm[2]
                const boundaryBuf = Buffer.from('--' + boundary)
                const fields = {}
                const files = {}
                let pos = buf.indexOf(boundaryBuf)
                while (pos !== -1) {
                    pos += boundaryBuf.length
                    const nextPos = buf.indexOf(boundaryBuf, pos)
                    if (nextPos === -1) break
                    const part = buf.slice(pos, nextPos)
                    // 去掉末尾的 \r\n--
                    const trimmedLen = part[part.length - 2] === 13 && part[part.length - 1] === 10 ? part.length - 2 : part.length
                    const content = part.slice(0, trimmedLen)
                    const headerEnd = content.indexOf('\r\n\r\n')
                    if (headerEnd === -1) { pos = nextPos; continue }
                    const headerStr = content.slice(0, headerEnd).toString()
                    const body = content.slice(headerEnd + 4)
                    // 去掉末尾 \r\n
                    const bodyContent = body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10
                        ? body.slice(0, body.length - 2) : body
                    const nameM = headerStr.match(/name="([^"]+)"/)
                    const filenameM = headerStr.match(/filename="([^"]+)"/)
                    if (nameM) {
                        const name = nameM[1]
                        if (filenameM) {
                            if (bodyContent.length > MAX_UPLOAD_FILE) throw new Error('file too large')
                            files[name] = {filename: filenameM[1], data: bodyContent, contentType: (headerStr.match(/Content-Type:\s*([^\s;]+)/i) || [])[1] || 'application/octet-stream'}
                        } else {
                            fields[name] = bodyContent.toString()
                        }
                    }
                    pos = nextPos
                }
                settleResolve({fields, files})
            } catch (e) { settleReject(e) }
        }
        const onError = error => settleReject(error)
        const onAborted = () => settleReject(new Error('upload aborted'))
        req.on('end', onEnd)
        req.on('error', onError)
        req.on('aborted', onAborted)
    })
}

// 功能说明: 将前端 thinking 等级（off/low/medium/high/xhigh/max）映射为 SDK thinking budgetTokens 配置
// 实现方式: switch 匹配 6 级 → {type:'disabled'} 或 {type:'enabled', budgetTokens:N}；默认 16000 tokens
// 关键数据流: 'high' → {type: 'enabled', budgetTokens: 16000} / 'off' → {type: 'disabled'}
function mapThinkingLevel(lv) {
    switch (lv) {
        case 'off':
            return {type: 'disabled'};
        case 'low':
            return {type: 'enabled', budgetTokens: 2000};
        case 'medium':
            return {type: 'enabled', budgetTokens: 8000};
        case 'high':
            return {type: 'enabled', budgetTokens: 16000};
        case 'xhigh':
            return {type: 'enabled', budgetTokens: 24000};
        case 'max':
            return {type: 'enabled', budgetTokens: 32000};
        default:
            return {type: 'enabled', budgetTokens: 16000}
    }
}

// ---- SDK message conversion ----
// ── SDK 消息转 WebSocket 格式（convertSdkToWs）──
// 功能说明: 将 Claude Agent SDK 的各种消息类型映射为前端统一的 WebSocket JSON 消息
//   负责消息类型的甄别、筛选（null 表示不转发）、参数重映射
// 实现方式: switch (sdkMsg.type) 匹配 6 种 SDK 消息类型，stream_event 委托给 mapStreamEvent 处理子类型
//   丢弃不需要的类型（返回 null → startStreamPump 不广播）
// 关键数据流: SDK message → switch type → 对应 WS 格式 → broadcast 或 null（跳过）
//   覆盖类型: system_init / stream_event(含 tool_use_start/thinking/text_delta 等) / assistant_message / user_message_echo / result / tool_progress
function convertSdkToWs(sdkMsg, sessionId) {
    switch (sdkMsg.type) {
        case 'system':
            if (sdkMsg.subtype === 'init') {
                const info = lookupModelInfo(sdkMsg.model);
                // PROVIDERS 查不到时，用 session 存储的前端传入 modelMeta 作为回退
                const s = sessions.get(sessionId);
                const mm = s?.modelMeta;
                return buildSystemInitEvent({sdkMsg, gatewaySessionId: sessionId, modelInfo: info, modelMeta: mm});
            }
            if (sdkMsg.subtype === 'compact_boundary') return compactBoundaryToEvent(sdkMsg)
            if (sdkMsg.subtype === 'task_started') {
                const s = sessions.get(sessionId)
                const agentType = String(sdkMsg.subagent_type || sdkMsg.task_type || 'unknown')
                const descriptor = buildAgentDescriptor(agentType, {
                    description: sdkMsg.description,
                    prompt: sdkMsg.prompt,
                }, s?.queryOpts?.agents || {})
                return {
                    type: 'subagent_start',
                    agentId: sdkMsg.task_id,
                    toolUseId: sdkMsg.tool_use_id || null,
                    agentType,
                    description: descriptor.task || descriptor.purpose,
                    ...descriptor,
                    ts: Date.now(),
                }
            }
            if (sdkMsg.subtype === 'task_progress') return {
                type: 'subagent_progress',
                agentId: sdkMsg.task_id,
                toolUseId: sdkMsg.tool_use_id || null,
                agentType: sdkMsg.subagent_type || 'unknown',
                currentAction: sdkMsg.last_tool_name || sdkMsg.description || '',
                progress: sdkMsg.summary || sdkMsg.description || '',
                usage: sdkMsg.usage || null,
                ts: Date.now(),
            }
            if (sdkMsg.subtype === 'task_notification') return {
                type: 'subagent_done',
                agentId: sdkMsg.task_id,
                toolUseId: sdkMsg.tool_use_id || null,
                status: sdkMsg.status,
                summary: sdkMsg.summary || '',
                usage: sdkMsg.usage || null,
                ts: Date.now(),
            }
            return null
        case 'stream_event':
            return mapStreamEvent(sdkMsg.event)
        case 'assistant':
            return {type: 'assistant_message', message: sdkMsg.message, error: sdkMsg.error}
        case 'user':
            if (isSyntheticCompactSummary(sdkMsg)) return null
            const userText = sdkMsg.message?.content?.find?.(block => block?.type === 'text')?.text
            if (isInternalWorkflowResultText(userText) || isAutoContinuationPrompt(userText)) return null
            return {type: 'user_message_echo', message: sdkMsg.message, timestamp: sdkMsg.timestamp}
        case 'result':
            const taskResult = classifyTaskResult(sdkMsg)
            const resultSession = sessions.get(sessionId)
            return {
                type: 'result',
                subtype: sdkMsg.subtype,
                duration_ms: sdkMsg.duration_ms,
                is_error: sdkMsg.is_error,
                num_turns: sdkMsg.num_turns,
                // 0.3.x: SDKResultError 无 result 字段，改用 errors 数组
                result: sdkMsg.result || sdkMsg.errors?.join('\n'),
                usage: sdkMsg.usage,
                modelUsage: sdkMsg.modelUsage,
                ...taskResult,
                resumable: canResumeTask(taskResult, Boolean(resultSession?.lastSessionId || sdkMsg.session_id)),
            }
        case 'tool_progress':
            return {
                type: 'tool_progress',
                tool_use_id: sdkMsg.tool_use_id,
                tool_name: sdkMsg.tool_name,
                elapsed_time_seconds: sdkMsg.elapsed_time_seconds
            }
        default:
            return null
    }
}

// ── SDK query 选项组装（makeQueryOptions）──
// 功能说明: 从请求体/环境变量/cli settings 三个来源拼装 SDK query() 所需的完整 options 对象
//   处理 apiKey 优先级、model 映射、权限模式、thinking 预算、env 注入等
// 实现方式:
//   1. 三源合并: body(前端请求) > process.env > cli settings.json
//   2. 删除 ELECTRON_RUN_AS_NODE（claude.exe 是 Electron 二进制，带此 env 会当 node 跑导致 ENOENT）
//   3. 非 bypass 模式注册 canUseTool 回调；bypass 下 SDK 不触发回调所以不注册
// 关键数据流: body + env + cliS → merge → {model, executable, cwd, permissionMode, thinking, maxTurns, mcpServers, env, canUseTool?}
function sanitizeMcpServers(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
    const out = {}
    for (const [name, raw] of Object.entries(input)) {
        if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name) || !raw || typeof raw !== 'object') continue
        const transport = raw.type || raw.transport || 'stdio'
        if (!['stdio', 'sse', 'http'].includes(transport)) continue
        if (transport === 'stdio') {
            if (typeof raw.command !== 'string' || !raw.command || raw.command.length > 2048 || /[\0\r\n]/.test(raw.command)) continue
            const args = Array.isArray(raw.args) ? raw.args : []
            if (args.length > 100 || args.some(a => typeof a !== 'string' || a.length > 4096 || /[\0\r\n]/.test(a))) continue
            const env = {}
            for (const [key, value] of Object.entries(raw.env || {})) {
                if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string' && value.length <= 4096 && !/[\0\r\n]/.test(value)
                    && !['BRIDGE_TOKEN', 'BRIDGE_ALLOW_TOKEN_ENDPOINT', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key)) env[key] = value
            }
            out[name] = {type: 'stdio', command: raw.command, args, ...(Object.keys(env).length ? {env} : {}), ...(raw.enabled === false ? {enabled: false} : {})}
            continue
        }
        let parsedUrl
        try { parsedUrl = new URL(raw.url) } catch { continue }
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) continue
        const headers = {}
        for (const [key, value] of Object.entries(raw.headers || {})) {
            if (key.toLowerCase() !== 'x-bridge-token' && /^[\x21-\x7e]{1,128}$/.test(key) && typeof value === 'string' && value.length <= 4096 && !/[\0\r\n]/.test(value)) headers[key] = value
        }
        out[name] = {type: transport, url: raw.url, ...(Object.keys(headers).length ? {headers} : {}), ...(raw.enabled === false ? {enabled: false} : {})}
    }
    return Object.keys(out).length ? out : undefined
}

const CHILD_ENV_KEYS = [
    'PATH', 'Path', 'PATHEXT', 'ComSpec', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP',
    'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'LANG', 'LC_ALL', 'TZ',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS',
]

function buildChildProcessEnv() {
    const env = {}
    for (const key of CHILD_ENV_KEYS) {
        if (typeof process.env[key] === 'string' && process.env[key]) env[key] = process.env[key]
    }
    return env
}

async function makeQueryOptions(body, workDir, cliS, extraEnv = {}, sessionId = null) {
    // 三源合并: body(前端临时切换) > cliS.env(settings) ; 不读 process.env 避免父进程 env 与 settings 不一致
    const configuredApiKey = cliS.env?.ANTHROPIC_AUTH_TOKEN || cliS.env?.ANTHROPIC_API_KEY || ''
    // 设置接口会脱敏返回 provider key；会话入口必须在 Gateway 内恢复，不能把 [REDACTED] 发给上游。
    const requestedApiKey = restoreSecretValue(body.apiKey || '', configuredApiKey)
    const apiKey = requestedApiKey || configuredApiKey
    let baseUrl = body.baseUrl || cliS.env?.ANTHROPIC_BASE_URL
    const exe = body.claudeExe || process.env.CLAUDE_EXE || cliS.claudeExe || getClaudeExe()
    const permissionMode = VALID_PERMISSION_MODES.has(body.permissionMode) ? body.permissionMode : 'default'
    const requestedMaxTurns = Number(body.maxTurns || cliS.maxTurns || 40)
    const contextProfile = normalizeContextProfile(body.contextProfile)
    const requestedSkillRoute = Array.isArray(body.skillRoute)
        ? [...new Set(body.skillRoute.filter(name => typeof name === 'string' && name.length <= 128))]
        : routeSkills({
            text: body.text || '',
            workDir,
            profile: contextProfile,
            targetFiles: body.targetFiles || [],
        })
    const skillRoute = contextProfile === 'light' ? [] : requestedSkillRoute
    const builtinSkills = ensureBuiltinSkillsAvailable(skillRoute, {bridgeHome: BRIDGE_HOME})
    if (builtinSkills.installed.length) {
        log.info({skills: builtinSkills.installed}, 'Bridge 内置 Skill 已准备')
    }
    const agents = contextProfile === 'full' ? (body._agents || loadAgentDefinitions()) : {}

    // DeepSeek 兼容代理: 自动路由请求通过本地代理修复参数冲突
    const usesDeepSeek = typeof baseUrl === 'string' && /deepseek/i.test(baseUrl)
    const usesCodexRelay = typeof baseUrl === 'string' && /\/api\/codex\/backend-api\/codex(?:\/|$)/i.test(baseUrl)
    let deepSeekProxyReady = false
    if (usesDeepSeek) {
        if (!_proxyStarting) {
            _proxyStarting = startDeepSeekProxy(baseUrl).finally(() => { _proxyStarting = null })
        }
        try {
            await _proxyStarting
            deepSeekProxyReady = isProxyConfiguredFor(baseUrl)
        } catch (e) {
            log.error({err: e}, 'DeepSeek proxy 启动失败')
        }
    }
    // OpenCode 协议翻译代理: Anthropic Messages → OpenAI Chat Completions
    // Zen /v1/messages 仅 Claude/Qwen，其他模型须走 /chat/completions
    if (baseUrl && baseUrl.includes('opencode') && !isOpenCodeProxyRunning()) {
        if (!_ocProxyStarting) {
            _ocProxyStarting = startOpenCodeProxy().finally(() => { _ocProxyStarting = null })
        }
        try { await _ocProxyStarting } catch (e) { log.error({err: e}, 'OpenCode proxy 启动失败') }
    }
    let effectiveBaseUrl = deepSeekProxyReady ? getProxyUrl()
        : (baseUrl && baseUrl.includes('opencode') && isOpenCodeProxyRunning()) ? getOpenCodeProxyUrl()
        : baseUrl

    const requestedModelMode = VALID_MODEL_MODES.has(body.modelMode)
        ? body.modelMode
        : (body.model ? 'fixed' : 'auto')
    const initialDecision = body.taskDecision || (body.text ? decideTask({text: body.text}) : null)
    const deferAutomaticQuery = shouldDeferAutomaticQuery({
        modelMode: requestedModelMode,
        hasTaskDecision: Boolean(initialDecision),
        hasConversationTarget: Boolean(body.resume || body.forkFrom),
    })
    const initialRoute = body._resolvedModel
        ? {mode: requestedModelMode, model: mapModel(body._resolvedModel), tier: initialDecision?.modelTier || null, blockingReason: null}
        : initialDecision
            ? resolveTaskModelRoute({
                modelMode: requestedModelMode,
                explicitModel: mapModel(body.model),
                decision: initialDecision,
                modelTiers: loadWfConfig().modelTiers,
                defaultModel: cliS.model || MODEL,
            })
            : {mode: requestedModelMode, model: mapModel(body.model) || cliS.model || MODEL, tier: null, blockingReason: null}
    if (initialRoute.blockingReason) {
        const error = new Error(initialRoute.blockingReason === 'power_model_required'
            ? '当前高风险任务需要配置 Power 模型后才能执行'
            : '当前供应商没有可用模型')
        error.code = initialRoute.blockingReason
        throw error
    }
    const resolvedModel = initialRoute.model || cliS.model || MODEL
    const compatibilityError = shouldValidateProviderModel({
        modelMode: requestedModelMode,
        hasTaskDecision: Boolean(initialDecision),
        hasConversationTarget: Boolean(body.resume || body.forkFrom),
    }) ? validateProviderModel({baseUrl, model: resolvedModel}) : null
    if (compatibilityError) {
        const error = new Error('当前 Codex Relay 不支持所选模型，请为该档位配置 Codex 模型')
        error.code = compatibilityError
        throw error
    }
    let sdkApiKey = apiKey
    if (usesCodexRelay && !deferAutomaticQuery) {
        const relayConfig = {upstream: baseUrl, apiKey, model: resolvedModel}
        try {
            const relay = await startCodexRelayProxy(relayConfig)
            effectiveBaseUrl = getCodexRelayProxyUrl()
            sdkApiKey = relay.token
        } catch (error) {
            log.error({err: error}, 'Codex Relay 代理启动失败')
            throw new Error(`Codex Relay 代理启动失败: ${error?.message || error}`)
        }
    }
    const configuredContextCap = parseTokenCount(body.maxContextTokens || cliS.maxContextTokens)
    const knownContextWindow = parseTokenCount(body.modelMeta?.contextWindow) || lookupModelInfo(resolvedModel).contextWindow
    const autoCompactWindow = calculateAutoCompactWindow(knownContextWindow, configuredContextCap)
    let opts = {
        model: resolvedModel,
        executable: 'node',
        cwd: workDir,
        permissionMode,
        allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
        thinking: mapThinkingLevel(VALID_THINKING_LEVELS.has(body.thinkingLevel) ? body.thinkingLevel : 'auto'),
        maxTurns: Number.isFinite(requestedMaxTurns) ? Math.min(100, Math.max(1, requestedMaxTurns)) : 40,
        mcpServers: sanitizeMcpServers(cliS.mcpServers),
        skills: skillRoute,
        stderr: (msg) => process.stderr.write(`[claude.exe stderr] ${msg}`),
        env: (() => {
            const modelName = resolvedModel
            const e = {
                ...buildChildProcessEnv(),
                CLAUDE_CODE_ENTRYPOINT: 'claude',
                CLAUDE_CONFIG_DIR: BRIDGE_HOME,
                ANTHROPIC_API_KEY: sdkApiKey,
                ANTHROPIC_AUTH_TOKEN: sdkApiKey,
                ANTHROPIC_BASE_URL: effectiveBaseUrl,
                ANTHROPIC_MODEL: modelName, ...extraEnv
            };
            delete e.ELECTRON_RUN_AS_NODE;
            // 子 agent 默认用 claude-* 模型名发给第三方供应商会 403，统一映射到当前模型
            // 须在 ANTHROPIC_API_KEY 之后再设 DEFAULT，防止 process.env 中的旧值残留
            if (usesCodexRelay || (effectiveBaseUrl && (effectiveBaseUrl.includes('minimax') || effectiveBaseUrl.includes('deepseek') || effectiveBaseUrl.includes('moonshot') || effectiveBaseUrl.includes('opencode') || effectiveBaseUrl.includes('bigmodel') || effectiveBaseUrl.includes('aliyun') || effectiveBaseUrl.includes('volces')))) {
                e.ANTHROPIC_DEFAULT_OPUS_MODEL = modelName
                e.ANTHROPIC_DEFAULT_SONNET_MODEL = modelName
                e.ANTHROPIC_DEFAULT_HAIKU_MODEL = modelName
                e.ANTHROPIC_SMALL_FAST_MODEL = modelName
            }
            // MiniMax Coding Plan: 需要长超时 + 禁用非必要流量
            if (effectiveBaseUrl && effectiveBaseUrl.includes('minimax')) {
                e.API_TIMEOUT_MS = '600000'
                e.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
            }
            return e
        })(),
        // 0.3.x 默认不发 stream_event，必须显式开启
        includePartialMessages: true,
        // 由 SDK 在安全阈值执行压缩，避免 Bridge 在 Agent 或工具运行中并发插入 /compact。
        settings: {
            autoCompactEnabled: true,
            ...(autoCompactWindow ? {autoCompactWindow} : {}),
        },
    }
    // Caveman: 会话级 systemPrompt.append 注入，仅对 Bridge 会话生效，不污染外部规则文件。
    const cavemanPrompt = buildCavemanSystemPrompt(cliS.caveman)
    if (cavemanPrompt) opts.systemPrompt = {type: 'preset', preset: 'claude_code', append: cavemanPrompt}
    // 有 native binary 路径时才传，否则 SDK 自动走自带的 cli.js
    if (exe) opts.pathToClaudeCodeExecutable = exe
    // canUseTool 始终注册，动态检查 s.permissionMode 实现即时权限切换
    if (sessionId) opts.canUseTool = makeCanUseTool(sessionId)
    // 注入 agent 定义（含内置+自定义），SDK 的 Task 工具用此列表找到子 agent
    if (Object.keys(agents).length) opts.agents = agents
    // 注册 Subagent 生命周期 hooks（SDK 子 agent 启动/停止时广播到前端）
    if (sessionId) {
        opts.hooks = {
            SubagentStart: [{
                matcher: '', timeout: 30, hooks: [(input) => {
                    const session = sessions.get(sessionId)
                    const queue = session?.pendingAgentSpawns || []
                    const pendingIndex = queue.findIndex(item => item.agentType === input.agent_type)
                    const pending = pendingIndex >= 0 ? queue.splice(pendingIndex, 1)[0] : null
                    const descriptor = pending || buildAgentDescriptor(input.agent_type, {}, agents)
                    if (session && pending?.toolUseId) {
                        session.agentToolUseByAgentId = session.agentToolUseByAgentId || new Map()
                        session.agentToolUseByAgentId.set(input.agent_id, pending.toolUseId)
                    }
                    broadcast(sessionId, {
                        type: 'subagent_start',
                        agentId: input.agent_id,
                        requestId: pending?.requestId,
                        toolUseId: pending?.toolUseId || null,
                        agentType: input.agent_type,
                        description: pending?.description || descriptor.task || descriptor.purpose,
                        purpose: descriptor.purpose,
                        task: descriptor.task || '',
                        scope: descriptor.scope || '',
                        currentAction: descriptor.currentAction || '',
                        descriptionSource: descriptor.descriptionSource || 'builtin',
                        ts: Date.now()
                    })
                    return {}
                }]
            }],
            SubagentStop: [{
                matcher: '', timeout: 30, hooks: [(input) => {
                    const session = sessions.get(sessionId)
                    const toolUseId = session?.agentToolUseByAgentId?.get(input.agent_id) || null
                    session?.agentToolUseByAgentId?.delete(input.agent_id)
                    broadcast(sessionId, {
                        type: 'subagent_done',
                        agentId: input.agent_id,
                        agentType: input.agent_type,
                        toolUseId,
                        transcriptPath: input.agent_transcript_path,
                        ts: Date.now()
                    })
                    // 清理子 agent transcript 文件，防止积累
                    if (input.agent_transcript_path) {
                        const projectsRoot = join(BRIDGE_HOME, 'projects')
                        const transcriptRelativePath = relative(projectsRoot, resolve(String(input.agent_transcript_path)))
                        const tp = safeChildPath(projectsRoot, transcriptRelativePath, {extensions: ['.jsonl']})
                        if (!tp) {
                            log.warn({sessionId: sessionId?.slice(0, 8)}, '拒绝清理项目目录外的子 Agent transcript')
                            return {}
                        }
                        const subDir = dirname(tp)
                        const inSubagents = basename(subDir) === 'subagents'
                        // 即时删除 transcript 文件
                        try {
                            if (existsSync(tp)) unlinkSync(tp)
                        } catch (error) {
                            log.warn({err: error, sessionId: sessionId?.slice(0, 8), path: tp}, '清理子 Agent transcript 失败')
                        }
                        if (inSubagents) {
                            // subagents/ 内文件: 直接删文件即可，尝试删空目录
                            try {
                                if (existsSync(subDir)) rmdirSync(subDir)
                            } catch (error) {
                                if (error?.code !== 'ENOTEMPTY' && error?.code !== 'ENOENT') {
                                    log.debug({err: error, sessionId: sessionId?.slice(0, 8), path: subDir}, '清理子 Agent 空目录失败')
                                }
                            }
                        } else {
                            // 顶层 agent-*.jsonl: 调 SDK deleteSession 完整清理
                            const sid = basename(tp).replace('.jsonl', '')
                            deleteSession(sid, {dir: subDir}).catch(error => {
                                log.warn({err: error, sessionId: sid?.slice(0, 8), path: subDir}, 'SDK 清理子 Agent Session 失败')
                            })
                        }
                    }
                    return {}
                }]
            }],
            PostToolUse: [{
                matcher: '', timeout: 10, hooks: [rtkPostToolUseHandler]
            }],
            PreCompact: [{
                matcher: '', timeout: 30, hooks: [(input) => {
                    broadcast(sessionId, {type: 'context_compacting', trigger: input.trigger || 'auto', ts: Date.now()})
                    return {}
                }]
            }],
        }
    }
    // 暴露本次生效的 env 给同进程兼容路径，替代写 process.env 全局
    opts.runtimeEnv = {
        CLAUDE_CONFIG_DIR: BRIDGE_HOME,
        ANTHROPIC_BASE_URL: effectiveBaseUrl,
        ANTHROPIC_API_KEY: sdkApiKey,
        ANTHROPIC_AUTH_TOKEN: sdkApiKey,
        ANTHROPIC_MODEL: resolvedModel,
    }
    if (usesCodexRelay || (effectiveBaseUrl && (effectiveBaseUrl.includes('minimax') || effectiveBaseUrl.includes('deepseek') || effectiveBaseUrl.includes('moonshot') || effectiveBaseUrl.includes('opencode') || effectiveBaseUrl.includes('bigmodel') || effectiveBaseUrl.includes('aliyun') || effectiveBaseUrl.includes('volces')))) {
        opts.runtimeEnv.ANTHROPIC_DEFAULT_OPUS_MODEL = resolvedModel
        opts.runtimeEnv.ANTHROPIC_DEFAULT_SONNET_MODEL = resolvedModel
        opts.runtimeEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL = resolvedModel
        opts.runtimeEnv.ANTHROPIC_SMALL_FAST_MODEL = resolvedModel
    }
    if (effectiveBaseUrl && effectiveBaseUrl.includes('minimax')) {
        opts.runtimeEnv.API_TIMEOUT_MS = '600000'
        opts.runtimeEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    }
    opts = applyContextProfile(opts, contextProfile, resolvedModel, {workDir})
    opts = applySkillRoute(opts, skillRoute)
    // 仅供 Bridge 保存 Session 状态；Claude Agent SDK 会忽略未知选项。
    opts.bridgeContextProfile = contextProfile
    opts.bridgeSkillRoute = skillRoute
    opts.bridgeContextSafetyCap = configuredContextCap
    opts.bridgeModelMode = requestedModelMode
    opts.bridgeTaskDecision = initialDecision
    opts.bridgeModelTier = initialRoute.tier || null
    opts.bridgeProviderBaseUrl = baseUrl || ''
    opts.bridgeProviderApiKey = apiKey || ''
    // SDK 的 Anthropic client 读 process.env(不读 opts.env)，直接设 process.env
    // 不再 restore: 多个 session 共享 process.env，restore 会导致 A 恢复 B 的值
    return opts
}

// ── SDK 消息流泵（startStreamPump）──
// 功能说明: 从 SDK query 的 async iterable 中逐条消费消息，转换并广播到 WebSocket 客户端
//   同时完成以下 side-effect 工作：缓存命令/agent 名单、累积本轮文本、触发记录点结算和镜像同步
// 实现方式:
//   1. for await (const sdkMsg of s.query) 逐条消费 SDK 消息
//   2. system/init 时缓存 commands/agentNames 到 dynamicCache + 记录 lastSessionId
//   3. assistant 消息累积文本到 s.turnText（供 IM 镜像同步用）
//   4. result 消息时：结算记录点(finalizeCheckpoint) + 镜像到 IM(maybeMirror)
//   5. convertSdkToWs 转换为 WS 格式 → broadcast 给桌面端
// 关键数据流: SDK async iterator → convertSdkToWs() → broadcast(wsMsg)
//   → 并行: finalizeCheckpoint() + maybeMirror() (result 时)
//   → catch: stream_error → broadcast error
async function refreshContextUsage(sessionId, session, reason) {
    if (!session?.query || typeof session.query.getContextUsage !== 'function') return
    if (session._contextUsageInFlight) return session._contextUsageInFlight
    session._contextUsageInFlight = (async () => {
        try {
            const usage = await withTimeout(Promise.resolve(session.query.getContextUsage()), 5_000)
            const configuredThreshold = parseTokenCount(session.queryOpts?.settings?.autoCompactWindow)
            const event = contextUsageEvent(usage, {
                reason,
                ...(configuredThreshold ? {autoCompactThreshold: configuredThreshold} : {}),
            })
            session.contextUsage = event
            broadcast(sessionId, event)
        } catch (error) {
            log.debug({err: error, sessionId: sessionId?.slice(0, 8), reason}, 'SDK 上下文用量读取失败')
        } finally {
            session._contextUsageInFlight = null
        }
    })()
    return session._contextUsageInFlight
}

function maybeRefreshContextUsage(sessionId, session, reason) {
    if (!session?.query || typeof session.query.getContextUsage !== 'function') return
    const now = Date.now()
    if (now - Number(session._lastContextUsageAt || 0) < 5_000) return
    session._lastContextUsageAt = now
    void refreshContextUsage(sessionId, session, reason)
}

async function startAutoContinuation(sessionId, session, request) {
    if (!session || sessions.get(sessionId) !== session || session._autoContinuationRequest !== request
        || !request?.prompt || !session.lastSessionId
        || !['running', 'fixing'].includes(session.taskCompletion?.phase)) return false
    const rebuildId = Symbol('auto-continuation')
    const pushStream = new PushStream()
    session._rebuildId = rebuildId
    session._pendingMessages = [request.prompt]
    session._rebuildPromise = (async () => {
        const cliS = loadCliSettings()
        session.pushStream = pushStream
        const bodyOverride = {
            resume: session.lastSessionId,
            model: session.queryOpts?.model,
            modelMode: session.modelMode || 'fixed',
            taskDecision: session.taskDecision || request.taskDecision || null,
            permissionMode: session.permissionMode,
            thinkingLevel: session.thinkingLevel,
            contextProfile: session.contextProfile || 'full',
            skillRoute: session.skillRoute || [],
            modelMeta: session.modelMeta || null,
            maxContextTokens: session.queryOpts?.bridgeContextSafetyCap || undefined,
            maxTurns: session.queryOpts?.maxTurns,
        }
        if (session.providerBaseUrl) bodyOverride.baseUrl = session.providerBaseUrl
        if (session.providerApiKey) bodyOverride.apiKey = session.providerApiKey
        const opts = await makeQueryOptions(bodyOverride, session.workDir, cliS, {}, sessionId)
        if (session._rebuildId !== rebuildId || session.pushStream !== pushStream
            || session._autoContinuationRequest !== request) return false
        opts.resume = session.lastSessionId
        session.query = startClaudeAgent(pushStream, opts)
        session.runtimeEnv = opts.runtimeEnv
        session.queryOpts = opts
        session.providerBaseUrl = opts.bridgeProviderBaseUrl || session.providerBaseUrl
        session.providerApiKey = opts.bridgeProviderApiKey || session.providerApiKey
        startStreamPump(sessionId)
        // query 已经接管续跑请求；后续追加消息只通过 _rebuildPromise 排队。
        session._autoContinuationRequest = null
        const pending = session._pendingMessages || []
        session._pendingMessages = null
        for (const content of pending) {
            pushStream.push({
                type: 'user', session_id: sessionId,
                message: {role: 'user', content: [{type: 'text', text: content}]},
                parent_tool_use_id: null,
            })
            session.hasUserTurns = true
        }
        session._rebuildPromise = null
        session._rebuildId = null
        return true
    })().catch(error => {
        if (session._rebuildId !== rebuildId) return false
        session._autoContinuationRequest = null
        session._rebuildPromise = null
        session._rebuildId = null
        session._pendingMessages = null
        session.pushStream = null
        session.query = null
        const detail = `自动续跑启动失败：${String(error?.message || error || '未知错误')}`
        log.error({err: error, sessionId: sessionId?.slice(0, 8)}, detail)
        const transition = updateTaskCompletion(session, sessionId, {type: 'runtime_failed', detail})
        void applyTaskCompletionEffects(sessionId, transition.effects).catch(effectError => {
            log.error({err: effectError, sessionId: sessionId?.slice(0, 8)}, '自动续跑失败后的任务收口失败')
            broadcastTurn(sessionId, {
                type: 'error', code: 'auto_continuation_failed', message: detail,
                durationMs: session.taskState?.durationMs || 0,
                taskState: taskStateForClient(session.taskState),
            }, request.identity || session.taskCompletionIdentity || null)
        })
        session._generating = false
        session.activeTurnId = null
        session.activeTurnIdentity = null
        const completedAt = Date.now()
        session.taskCompletedAt = completedAt
        const startedAt = Number(session.taskStartedAt || session.taskState?.startedAt || completedAt)
        updateTaskState(session, sessionId, taskStateForError(error, {
            sdkSessionId: session.lastSessionId,
            historySessionId: session.lastSessionId,
            startedAt,
            completedAt,
            durationMs: Math.max(0, completedAt - startedAt),
        }))
        return false
    })
    await session._rebuildPromise
    return Boolean(session.query)
}

async function startStreamPump(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return
    const myQuery = s.query  // 记录此 pump 持有的 query 对象引用
    armStreamWatchdog(sessionId, s, myQuery)
    try {
        for await (const sdkMsg of myQuery) {
            armStreamWatchdog(sessionId, s, myQuery)
            maybeRefreshContextUsage(sessionId, s, `running:${sdkMsg.type || 'event'}`)
            if (sdkMsg.type === 'system' && sdkMsg.subtype === 'init') {
                if (sdkMsg.session_id) {
                    s.lastSessionId = sdkMsg.session_id; s._hasConversation = true
                    // SDK ID 到达后补写别名，保证 Gateway 重启/resume 后仍能恢复镜像开关。
                    if (!persistSessionMirrors(s, sessionId)) {
                        log.warn({sessionId: sessionId?.slice(0, 8)}, 'Session 镜像别名未持久化')
                    }
                    if (s.taskState?.status === 'running') {
                        updateTaskState(s, sessionId, {
                            ...s.taskState,
                            sdkSessionId: sdkMsg.session_id,
                            historySessionId: sdkMsg.session_id,
                            resumable: true,
                        })
                    }
                    // 持久化 gateway sessionId → SDK conversationId 映射，供重启 resume 使用
                    if (!persistSdkSessionId(s.workDir, sessionId, sdkMsg.session_id)) {
                        log.warn({sessionId: sessionId?.slice(0, 8)}, 'Session 映射未持久化，重启后可能无法续接')
                    }
                    const visibleSource = s.visibleSource
                        || sessionVisibilitySource(getProjectVisibility(s.workDir), sessionId, sdkMsg.session_id)
                    if (visibleSource) {
                        s.visibleSource = visibleSource
                        if (!markVisibleSession(s.workDir, sessionId, sdkMsg.session_id, visibleSource)) {
                            log.warn({sessionId: sessionId?.slice(0, 8)}, 'Session 可见性未持久化')
                        }
                        broadcastDesktop(sessionId, {
                            type: 'session_visible',
                            sessionId,
                            historySessionId: sdkMsg.session_id,
                            source: visibleSource,
                        })
                    }
                }
                // 顺手把 init 暴露的命令/agent 名单缓存下来，供设置页冷启动读取
                if (Array.isArray(sdkMsg.slash_commands)) {
                    dynamicCache.commands = sdkMsg.slash_commands.map(n => ({
                        name: n,
                        description: '',
                        argumentHint: ''
                    }));
                    dynamicCache.updatedAt = Date.now()
                }
                if (Array.isArray(sdkMsg.agents)) dynamicCache.agentNames = sdkMsg.agents
                persistDynamicCache()
                // 缓存 SDK 内置 skills/agents/commands 名单（与硬编码兜底列表合并，取并集）
                if (Array.isArray(sdkMsg.skills)) builtinCache.skills = [...new Set([...builtinCache.skills, ...sdkMsg.skills])]
                if (Array.isArray(sdkMsg.agents)) builtinCache.agents = [...new Set([...builtinCache.agents, ...sdkMsg.agents])]
                if (Array.isArray(sdkMsg.slash_commands)) builtinCache.commands = sdkMsg.slash_commands.map(n => typeof n === 'string' ? {
                    name: n,
                    description: '',
                    argumentHint: ''
                } : n)
                builtinCache.updatedAt = Date.now()
                void refreshContextUsage(sessionId, s, 'init')
            }
            // SDK 真正消费 user prompt 时才切换回合上下文。输入可能提前排队，不能在
            // WebSocket 到达时重置上一回合的文本和工具计数，否则镜像会串回合。
            if (sdkMsg.type === 'user') {
                const workflowResultId = taskWorkflowResultIdFromMessage(sdkMsg.message)
                const consumedWorkflowResult = consumeTaskWorkflowResultTurn(s._taskWorkflowGate, workflowResultId)
                const inputMeta = consumedWorkflowResult ? null : s._pendingInputs?.shift()
                const legacySource = consumedWorkflowResult ? null : s._pendingSources?.shift()
                s._internalWorkflowResultTurnId = consumedWorkflowResult ? workflowResultId : null
                s._generating = true
                s.activeTurnId = consumedWorkflowResult ? null : inputMeta?.turnId || null
                s.lastTurnSource = consumedWorkflowResult
                    ? s.taskCompletionIdentity?.source || s.lastTurnSource || 'desktop'
                    : inputMeta?.source || legacySource || s.lastTurnSource || 'desktop'
                s.activeTurnIdentity = consumedWorkflowResult && s.taskCompletionIdentity
                    ? {...s.taskCompletionIdentity}
                    : createTurnIdentity(s.lastTurnSource, inputMeta?.userId, IM_SOURCES)
                s.activeTaskDecision = consumedWorkflowResult
                    ? s.taskCompletionDecision || s.taskDecision || null
                    : inputMeta?.taskDecision || s.taskDecision || null
                s.turnText = ''
            }
            // 累积本轮文本（assistant 消息为权威完整版，用于 IM 镜像同步）
            // assistant 覆盖 text_delta 的增量累积，保证 mirror 拿到 SDK 提供的完整文本
            if (sdkMsg.type === 'assistant') {
                let completeText = ''
                for (const b of (sdkMsg.message?.content || [])) {
                    if (b.type === 'text' && b.text) completeText += b.text
                }
                if (completeText) {
                    s.turnText = completeText.slice(-100000)  // 上限 100KB，防长轮内存膨胀
                    // 检测 [WF:run 脚本名 {args}] 指令（仅当全局开关 enabled 时）
                    if (loadWfConfig().enabled) {
                        const wfMatch = s.turnText.match(/\[WF:run\s+([\w.-]+?)\s+(\{[\s\S]*?\})\]/);
                        if (wfMatch && !s._wfRan) {
                            const wfName = wfMatch[1];
                            let wfArgs = {};
                            try {
                                wfArgs = JSON.parse(wfMatch[2]);
                            } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
                            const valid = getWorkflow(wfName + '.mjs') || getWorkflow(wfName);
                            if (!valid) {
                                log.warn({sessionId: sessionId?.slice(0, 8), wfName}, '[WF:run] 脚本名无效，已忽略');
                            } else {
                                s._wfRan = true;
                                log.info({sessionId: sessionId?.slice(0, 8), wfName, wfArgs}, '[WF:run] 已触发');
                                runWfScript(wfName, sessionId, {...wfArgs, _runKey: `${wfName}:${sessionId}`}).catch(function (e) {
                                    log.error({err: e, sessionId: sessionId?.slice(0, 8), wfName}, 'Workflow 引擎错误');
                                });
                            }
                        }
                    }
                }
            }
            // result 只标志主 SDK 回合结束；父任务是否完成由 task-completion 协调器决定。
            if (sdkMsg.type === 'result' && s._internalWorkflowResultTurnId) {
                const workflowTurn = finishTaskWorkflowResultTurn(
                    s._taskWorkflowGate,
                    s._internalWorkflowResultTurnId,
                )
                s._internalWorkflowResultTurnId = null
                s._pendingCompletionEffects = []
                if (workflowTurn.deferredPrimaryResult) {
                    const transition = updateTaskCompletion(s, sessionId, workflowTurn.deferredPrimaryResult)
                    s._pendingCompletionEffects = transition.effects
                } else if (workflowTurn.consumed && !hasPendingTaskWorkflow(s._taskWorkflowGate)) {
                    log.warn({sessionId: sessionId?.slice(0, 8)}, '内部 Workflow 回合结束时没有可结算的父任务结果')
                }
                s.turnText = ''
                void refreshContextUsage(sessionId, s, 'workflow-result')
            } else if (sdkMsg.type === 'result') {
                const taskResult = classifyTaskResult({...sdkMsg, finalText: s.turnText})
                const completionDecision = s.activeTaskDecision || s.taskCompletionDecision || s.taskDecision || null
                const segmentTurns = Math.max(0, Math.trunc(Number(sdkMsg.num_turns) || 0))
                const totalTurns = Math.max(0, Number(s.autoContinuationTurns || 0)) + segmentTurns
                const continuation = resolveAutoContinuation({
                    result: taskResult,
                    decision: completionDecision,
                    attempt: s.autoContinuationCount,
                    hasConversation: Boolean(s.lastSessionId || sdkMsg.session_id),
                    taskActive: ['running', 'fixing'].includes(s.taskCompletion?.phase),
                })
                if (continuation.shouldContinue) {
                    try {
                        maybeUpdateProjectCache(sessionId, s)
                    } catch (error) {
                        log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '自动续跑前更新 project-cache 失败')
                    }
                    try {
                        finalizeCheckpoint(sessionId)
                    } catch (error) {
                        log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '自动续跑前保存 checkpoint 失败')
                    }
                    s.autoContinuationCount = continuation.attempt
                    s.autoContinuationTurns = totalTurns
                    s.lastTaskResult = {
                        ...taskResult,
                        subtype: sdkMsg.subtype,
                        resumable: true,
                        result: `达到单段轮数上限，正在自动续跑（第 ${continuation.attempt}/${continuation.maxAttempts} 次）`,
                        rawResult: sdkMsg.result || sdkMsg.errors?.join('\n') || '',
                        numTurns: totalTurns,
                        at: Date.now(),
                    }
                    const continuationIdentity = s.activeTurnIdentity ? {...s.activeTurnIdentity} : s.taskCompletionIdentity || null
                    s._autoContinuationRequest = {
                        ...continuation,
                        taskDecision: completionDecision,
                        turnId: s.activeTurnId || s.taskCompletionTurnId || null,
                        source: continuationIdentity?.source || s.lastTurnSource || 'desktop',
                        userId: continuationIdentity?.userId || null,
                        identity: continuationIdentity,
                    }
                    if (!Array.isArray(s._pendingInputs)) s._pendingInputs = []
                    s._pendingInputs.unshift({
                        messageId: null,
                        turnId: s._autoContinuationRequest.turnId,
                        source: s._autoContinuationRequest.source,
                        userId: s._autoContinuationRequest.userId,
                        taskDecision: completionDecision,
                    })
                    beginTurn(sessionId, continuation.prompt, {
                        captureFiles: shouldCaptureTurnCheckpoint(completionDecision),
                    })
                    appendSessionEvent(s, 'task/auto-continuing', {
                        turnId: s._autoContinuationRequest.turnId,
                        attempt: continuation.attempt,
                        maxAttempts: continuation.maxAttempts,
                        tier: continuation.tier,
                        completedTurns: totalTurns,
                    })
                    updateTaskState(s, sessionId, {
                        ...s.taskState,
                        status: s.taskCompletion?.phase === 'fixing' ? 'fixing' : 'running',
                        outcome: null,
                        continuationReason: null,
                        resumable: true,
                        numTurns: totalTurns,
                        detail: `达到单段轮数上限，正在自动续跑（第 ${continuation.attempt}/${continuation.maxAttempts} 次）`,
                        completedAt: 0,
                        durationMs: 0,
                    })
                    taskCompletionEventForClient(s, sessionId, 'task_auto_continuing', {
                        attempt: continuation.attempt,
                        maxAttempts: continuation.maxAttempts,
                        tier: continuation.tier,
                        completedTurns: totalTurns,
                    })
                    s.turnText = ''
                    s._generating = false
                    // 结束已达上限的 SDK 输入流，pump 收口后再用同一 session 重建下一段。
                    try { s.pushStream?.close() } catch (error) {
                        log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '自动续跑关闭旧输入流失败')
                    }
                    void refreshContextUsage(sessionId, s, 'max-turns')
                    continue
                }
                s.lastTaskResult = {
                    ...taskResult,
                    subtype: sdkMsg.subtype,
                    resumable: canResumeTask(taskResult, Boolean(s.lastSessionId || sdkMsg.session_id)),
                    result: sdkMsg.result || sdkMsg.errors?.join('\n') || '',
                    numTurns: totalTurns,
                    at: Date.now(),
                }
                // maybeUpdateProjectCache 必须在 finalizeCheckpoint 之前调用：
                // finalizeCheckpoint 会清 s.pendingTurn，而 maybeUpdateProjectCache 依赖它拿 preSnapshot
                try {
                    maybeUpdateProjectCache(sessionId, s)
                } catch (e) {
                    log.warn({err: e, sessionId: sessionId?.slice(0, 8)}, 'project-cache 更新失败')
                }
                let checkpoint = null
                try {
                    checkpoint = finalizeCheckpoint(sessionId)
                } catch (e) {
                    log.warn({err: e, sessionId: sessionId?.slice(0, 8)}, 'finalizeCheckpoint 失败')
                }
                const fixing = s.taskCompletion?.phase === 'fixing'
                const workflowEnabled = loadWfConfig().enabled
                const reviewPlan = fixing && s.taskCompletion?.reviewPlan
                    ? s.taskCompletion.reviewPlan
                    : workflowEnabled
                        ? resolveFinalReviewPlan({decision: completionDecision, checkpoint})
                        : {required: false, tier: 'none', mode: 'none', riskDomains: []}
                if (checkpoint?.files?.length) {
                    const previous = fixing && Array.isArray(s.taskReviewFiles) ? s.taskReviewFiles : []
                    const byPath = new Map(previous.map(file => [file.path, file]))
                    for (const file of checkpoint.files) byPath.set(file.path, file)
                    s.taskReviewFiles = [...byPath.values()]
                    s.taskReviewCheckpointId = checkpoint.id
                }
                s.taskCompletionDecision = completionDecision
                s.taskCompletionIdentity = s.activeTurnIdentity ? {...s.activeTurnIdentity} : s.taskCompletionIdentity || null
                s.taskFinalReplyText = String(s.turnText || s.lastTaskResult.result || '').trim().slice(-100000)
                const primaryResultEvent = {
                    type: 'primary_result',
                    result: {
                        ...taskResult,
                        detail: s.lastTaskResult.result,
                        text: s.taskFinalReplyText,
                    },
                    reviewPlan,
                }
                if (deferPrimaryResultForTaskWorkflow(s._taskWorkflowGate, primaryResultEvent)) {
                    s._pendingCompletionEffects = []
                } else {
                    takeDeferredPrimaryResult(s._taskWorkflowGate)
                    const transition = updateTaskCompletion(s, sessionId, primaryResultEvent)
                    s._pendingCompletionEffects = transition.effects
                }
                taskCompletionEventForClient(s, sessionId, 'primary_completed', {
                    primaryOutcome: taskResult.outcome,
                    detail: s.lastTaskResult.result || '',
                })
                s.turnText = ''
                s.autoContinuationTurns = 0
                void refreshContextUsage(sessionId, s, 'result')
            }
            if (sdkMsg.type === 'result') s._generating = false
            const clientSdkMsg = sdkMsg.type === 'result' && s.lastTaskResult?.numTurns
                ? {...sdkMsg, num_turns: s.lastTaskResult.numTurns}
                : sdkMsg
            const wsMsg = convertSdkToWs(clientSdkMsg, sessionId)
            if (wsMsg) broadcastTurn(sessionId, {
                ...wsMsg,
                turnId: s.activeTurnId || null,
                parentTaskTerminal: sdkMsg.type === 'result' ? ['succeeded', 'failed', 'incomplete'].includes(s.taskCompletion?.phase) : undefined,
                taskState: sdkMsg.type === 'result' ? taskStateForClient(s.taskState) : undefined,
            }, s.activeTurnIdentity)
            if (sdkMsg.type === 'result') {
                const effects = Array.isArray(s._pendingCompletionEffects) ? s._pendingCompletionEffects.splice(0) : []
                void applyTaskCompletionEffects(sessionId, effects).catch(error => {
                    log.error({err: error, sessionId: sessionId?.slice(0, 8)}, '父任务完成副作用处理失败')
                })
                s.activeTurnId = null
                s.activeTurnIdentity = null
                s.activeTaskDecision = null
            }
            // text_delta 兜底累积到 turnText，防止后续轮次 SDK 不发 assistant 消息导致 mirror 丢文本
            if (wsMsg?.type === 'text_delta' && wsMsg.text) {
                s.turnText = ((s.turnText || '') + wsMsg.text).slice(-100000)
            }
            if (wsMsg?.type === 'tool_use_start') {
                try {
                    maybeInjectProjectCache(sessionId, s, wsMsg)
                } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
                try {
                    maybeInjectGitContext(sessionId, s)
                } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
            }
        }
    } catch (e) {
        log.error({err: e, sessionId: sessionId?.slice(0, 8)}, 'pump 异常')
        const failedSession = sessions.get(sessionId)
        const failedTurnIdentity = failedSession?.activeTurnIdentity ? {...failedSession.activeTurnIdentity} : null
        const watchdogTriggered = failedSession?._streamWatchdogTriggered === myQuery
        if (failedSession?.query === myQuery && !watchdogTriggered) {
            clearTaskWorkflowGate(failedSession._taskWorkflowGate)
            failedSession._internalWorkflowResultTurnId = null
            const transition = updateTaskCompletion(failedSession, sessionId, {
                type: 'runtime_failed',
                detail: String(e?.message || e || '任务执行异常中断'),
            })
            void applyTaskCompletionEffects(sessionId, transition.effects).catch(error => {
                log.error({err: error, sessionId: sessionId?.slice(0, 8)}, 'runtime 异常后的父任务失败通知处理失败')
            })
            failedSession._generating = false
            failedSession.activeTurnId = null
            failedSession.activeTurnIdentity = null
            failPendingSessionInputs(sessionId, failedSession, e)
            const completedAt = Date.now()
            failedSession.taskCompletedAt = completedAt
            const startedAt = Number(failedSession.taskStartedAt || failedSession.taskState?.startedAt || completedAt)
            updateTaskState(failedSession, sessionId, taskStateForError(e, {
                sdkSessionId: failedSession.lastSessionId,
                historySessionId: failedSession.lastSessionId,
                startedAt,
                completedAt,
                durationMs: Math.max(0, completedAt - startedAt),
            }))
            appendSessionEvent(failedSession, 'runtime/failed', {
                turnId: failedSession.taskState.turnId,
                code: typeof e?.code === 'string' ? e.code.slice(0, 120) : 'stream_error',
                durationMs: failedSession.taskState.durationMs,
            })
        }
        if (e.message !== 'cancelled' && !watchdogTriggered) broadcastTurn(sessionId, {
            type: 'error',
            message: e.message,
            code: 'stream_error',
            durationMs: failedSession?.taskState?.durationMs || 0,
            taskState: taskStateForClient(failedSession?.taskState),
        }, failedTurnIdentity)
        if (failedSession) broadcastTaskLifecycle(sessionId)
    } finally {
        const s2 = sessions.get(sessionId);
        if (s2?._streamWatchdogQuery === myQuery) clearStreamWatchdog(s2, myQuery)
        if (s2?._streamWatchdogTriggered === myQuery) s2._streamWatchdogTriggered = null
        const autoContinuationRequest = s2?.query === myQuery ? s2._autoContinuationRequest : null
        // 仅当 query 未被重建替换时才置空，避免覆盖新 pump 持有的 query
        if (s2 && s2.query === myQuery) {
            s2._generating = false
            s2.query = null
            if (autoContinuationRequest) {
                try { s2.pushStream?.close() } catch (error) {
                    log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '关闭已达轮数上限的输入流失败')
                }
                s2.pushStream = null
            }
        }
        if (s2 && s2.query === null && !autoContinuationRequest && s2._onPumpDone) {
            const onPumpDone = s2._onPumpDone
            s2._onPumpDone = null
            try { onPumpDone() } catch (e) {
                log.warn({err: e, sessionId: sessionId?.slice(0, 8)}, '定时任务清理回调失败')
            }
        }
        // 定时任务临时 session (无固定 sessionId) 完成后自动清理，防止累积
        if (s2?._autoDelete && !autoContinuationRequest && !s2.clients?.size) {
            markSessionDeleted(sessionId)
            finishImProgressReporters(sessionId)
            sessions.delete(sessionId)
            clearAdapterBindingsForSessions(sessionId, s2.lastSessionId)
            if (focusedSessionId === sessionId) focusedSessionId = null
            invalidateProjectsCache()
            deleteSessionFiles(sessionId, [s2.lastSessionId]).catch(error => {
                log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '清理临时 Session 文件失败')
            })
        }
        if (autoContinuationRequest && sessions.get(sessionId) === s2) {
            // 立即建立 rebuildPromise，避免用户追加消息与自动续跑各自启动一个 query。
            void startAutoContinuation(sessionId, s2, autoContinuationRequest)
        }
    }
}

// ── 微信文本分段发送（按 UTF-8 字节切片 + 分页标记，避免超长被微信截断）──
const WX_MAX_BYTES = 3500       // 单条文本字节上限（留余量，中文 1 字 3 字节）
const WX_MARKER_RESERVE = 16    // 给【n/N】分页标记预留的字节
// 按字节切片，遍历码点不拆坏多字节字符
// 功能说明: 按 UTF-8 字节数切片文本，不拆坏多字节字符（中文一字 3 字节不会从中切开）
// 实现方式: 逐码点遍历，用 Buffer.byteLength 计算每个字符的 UTF-8 字节数，累加超过 maxBytes 时切段
// 关键数据流: text → for ch of String(text) → 累加 byteLength → 超限切段 → [segment1, segment2, ...]
// ── splitByBytes — 按 UTF-8 字节边界安全分段 ──
// 功能说明: 将文本按 UTF-8 字节数切成多段，确保不在多字节字符（如中文）中间切断
// 实现方式: 逐字符累加 Buffer.byteLength(ch, 'utf8')，超过 maxBytes 时在最后一个完整字符处分段
//   保证每段输出都是合法的 UTF-8 字符串，不会产生乱码
// 关键数据流: text → 逐字符累计字节 → 超限时 cut → parts[] → 返回至少一个元素([''] 兜底)
function splitByBytes(text, maxBytes) {
    const out = [];
    let cur = '';
    let n = 0
    for (const ch of String(text)) {
        const b = Buffer.byteLength(ch, 'utf8')
        if (n + b > maxBytes && cur) {
            out.push(cur);
            cur = '';
            n = 0
        }
        cur += ch;
        n += b
    }
    if (cur) out.push(cur)
    return out.length ? out : ['']
}

// 顺序分段发送给微信，返回 {sent, parts}
// 功能说明: 将长文本按 UTF-8 字节切片分段发送到微信 iLink Bot，避免超长被截断
// 实现方式: splitByBytes 按字节边界切片（不拆坏多字节字符），+【n/N】分页标记；条间 400ms 延迟防乱序/限频
// 关键数据流: fullText → splitByBytes(max WX_MAX_BYTES-16) → forEach chunk → iLink API POST → {sent, parts}
async function sendWeChatChunks(bn, token, userId, contextToken, fullText) {
    const parts = splitByBytes(fullText, WX_MAX_BYTES - WX_MARKER_RESERVE)
    const total = parts.length
    // contextToken 为空时用 message_state=1（推送消息），有值时用 message_state=2（回复消息）
    const messageState = contextToken ? 2 : 1
    let sent = true
    for (let i = 0; i < total; i++) {
        const body = total > 1 ? `【${i + 1}/${total}】\n${parts[i]}` : parts[i]
        try {
            const ir = await fetch(`${bn}ilink/bot/sendmessage`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'iLink-App-Id': 'bot',
                    'iLink-App-ClientVersion': '853081',
                    'Authorization': `Bearer ${token}`,
                    'AuthorizationType': 'ilink_bot_token'
                },
                body: JSON.stringify({
                    msg: {
                        from_user_id: '',
                        to_user_id: userId,
                        client_id: `gw-${Date.now()}-${i}`,
                        message_type: 2,
                        message_state: messageState,
                        context_token: contextToken || '',
                        item_list: [{type: 1, text_item: {text: body}}]
                    }, base_info: {channel_version: '0.1.0'}
                }),
                signal: AbortSignal.timeout(10000),
            })
            const d = await ir.json()
            if (!(ir.ok && (!d.ret || d.ret === 0))) sent = false
        } catch {
            sent = false
        }
        if (i < total - 1) await new Promise(r => setTimeout(r, 400))  // 条间小延迟，避免乱序/限频
    }
    return {sent, parts: total}
}

// 多平台镜像：遍历所有适配器，mirror 已开启的才推（各适配器自行实现 sendToUser/findUserForSession）
// ── 多平台镜像同步（maybeMirror）──
// 功能说明: 每个回合结束后，将本轮累积的 Claude 回复文本推送到所有开启 mirror 的 IM 平台
//   遍历 confirmHooks，仅对 session.mirrors[hook.platform]===true 的适配器调用 sendToUser
// 实现方式: 取 s.turnText 文本，trim 后非空则逐适配器 hook.sendToUser(sid, text)；各适配器负责自己的格式化/发送逻辑
// 关键数据流: s.turnText（startStreamPump 中累积）→ 遍历 confirmHooks
//   → check s.mirrors[hook.platform] → hook.sendToUser(sid, text) → IM 平台
async function maybeMirror(sid, taskResult = {outcome: 'succeeded'}, notificationId = null) {
    const s = sessions.get(sid)
    if (!s) return {attempted: 0, sent: 0, pending: 0, failed: 0}
    const text = buildIncompleteMirrorText(s.turnText || s.taskFinalReplyText || s.taskState?.detail, taskResult)
    if (!text) return {attempted: 0, sent: 0, pending: 0, failed: 0}
    const turnIdentity = s.activeTurnIdentity ? {...s.activeTurnIdentity} : null
    const summary = {attempted: 0, sent: 0, pending: 0, failed: 0}
    for (const hook of confirmHooks) {
        if (!s.mirrors[hook.platform]) continue
        if (!shouldRouteMirror(hook.platform, turnIdentity)) continue
        summary.attempted++
        try {
            const result = await hook.sendToUser(sid, text, turnIdentity?.userId || null, notificationId)
            if (result === true || result?.sent === true) {
                summary.sent++
                updateTaskNotificationState(s, sid, hook.platform, 'sent', notificationId)
            } else if (result?.queued === true) {
                summary.pending++
                updateTaskNotificationState(s, sid, hook.platform, 'pending', notificationId, result.error || 'queued_for_retry')
            } else {
                summary.failed++
                updateTaskNotificationState(s, sid, hook.platform, 'failed', notificationId, result?.error || 'send_failed')
            }
        } catch (e) {
            summary.failed++
            updateTaskNotificationState(s, sid, hook.platform, 'failed', notificationId, e?.message || e)
            log.warn({err: e, platform: hook.platform, sessionId: sid?.slice(0, 8)}, 'mirror sendToUser 失败')
        }
    }
    return summary
}

async function reconcileTaskNotificationIntents(sessionId, session = sessions.get(sessionId), platform = null) {
    if (!session?.taskState || !['succeeded', 'failed', 'incomplete', 'review_paused', 'interrupted'].includes(session.taskState.status)) return false
    const pending = Object.entries(session.taskState.notifications || {}).filter(([name, item]) =>
        (!platform || name === platform) && ['pending', 'failed'].includes(item?.state))
    if (!pending.length) return false
    const missing = pending.some(([name, item]) => {
        const hook = getAdapterHook(name)
        return hook && !hook.notificationState?.(item.notificationId)
    })
    if (!missing) return false
    const outcome = session.taskState.status === 'succeeded'
        ? 'succeeded'
        : session.taskState.status === 'incomplete' || session.taskState.status === 'review_paused' ? 'incomplete' : 'failed'
    const notificationId = pending[0][1]?.notificationId
        || `${session.taskState.taskId || sessionId}:${outcome === 'succeeded' ? 'task_completed' : outcome === 'incomplete' ? 'task_review_paused' : 'task_failed'}`
    try {
        await maybeMirror(sessionId, {outcome, continuationReason: outcome === 'succeeded' ? null : 'execution_error'}, notificationId)
        return true
    } catch (error) {
        log.warn({err: error, sessionId: String(sessionId).slice(0, 8)}, '恢复缺失的任务通知意图失败')
        return false
    }
}

// ── 项目结构缓存注入（maybeInjectProjectCache）──
// 功能说明: 检测到 Claude 正在探索项目结构时（Glob/Grep/Agent Explore/Bash find），
//   如果存在项目缓存则注入摘要到 pushStream，避免重复探索
//   每 session 只注入一次（_cacheInjected 标记）
// 实现方式: isExplorationAttempt 判定 → loadProjectCache 读缓存 → pushStream.push 注入
function maybeInjectProjectCache(sessionId, s, wsMsg) {
    if (s._cacheInjected) return
    // stop_generation 后 pushStream 被置 null，此时注入会抛 NPE
    if (!s.pushStream) return
    const toolName = wsMsg.tool_name
    const input = wsMsg.input
    if (!isExplorationAttempt(toolName, input)) return
    const cache = loadProjectCache(s.workDir)
    if (!cache) return
    const text = buildCacheInjectionText(cache)
    if (!text) return
    s._cacheInjected = true
    markInternalInput(s)
    s.pushStream.push({
        type: 'user',
        session_id: sessionId,
        message: {role: 'user', content: [{type: 'text', text}]},
        parent_tool_use_id: null,
    })
    log.info({sessionId: sessionId?.slice(0, 8), toolName}, 'project-cache 已注入')
}

// ── 项目缓存增量更新（maybeUpdateProjectCache）──
// 功能说明: 每个回合结束时（result 事件），用已有 preSnapshot 与当前文件对比
//   有变更 → 增量更新缓存；无缓存 → 全量构建
async function maybeUpdateProjectCache(sessionId, s) {
    if (!s.pendingTurn?.preSnapshot) return
    const cache = loadProjectCache(s.workDir)
    const scan = currentFileScan(s.workDir, s.pendingTurn.preSnapshot)
    if (scan.missing) return
    const diffMap = diffSnapshotVsCurrent(s.pendingTurn.preSnapshot, scan.files, s.workDir)
    const changedCount = [...diffMap.values()].filter(d => d.status !== 'unchanged').length
    if (changedCount === 0 && cache) return // 无变更，跳过
    if (!cache) {
        const newCache = await buildProjectCache(s.workDir)
        if (newCache) saveProjectCache(s.workDir, newCache)
    } else {
        const result = await updateProjectCache(s.workDir, cache, diffMap)
        if (result.updated > 0) {
            saveProjectCache(s.workDir, cache)
            log.info({
                sessionId: sessionId?.slice(0, 8),
                updated: result.updated,
                skipped: result.skipped
            }, 'project-cache 已更新')
        }
    }
}

// ── Git 上下文注入（buildGitContext + maybeInjectGitContext）──
// 复用 maybeInjectProjectCache 的模式：首次 tool_use_start 时注入伪用户消息
function buildGitContext(workDir) {
    try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: workDir, encoding: 'utf8', timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim()
        const head = execSync('git rev-parse --short HEAD', {
            cwd: workDir, encoding: 'utf8', timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim()
        const log = execSync('git log --oneline -10', {
            cwd: workDir, encoding: 'utf8', timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim()
        const status = execSync('git status --short', {
            cwd: workDir, encoding: 'utf8', timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim()
        return `[GitContext]
Branch: ${branch}
HEAD: ${head}

最近 10 条提交:
${log}

工作区状态:
${status || '(clean)'}`
    } catch { return null }
}

function maybeInjectGitContext(sessionId, s) {
    if (s._gitInjected) return
    if (!s.pushStream) return
    if (!s._gitContext) return
    s._gitInjected = true
    markInternalInput(s)
    s.pushStream.push({
        type: 'user',
        session_id: sessionId,
        message: {role: 'user', content: [{type: 'text', text: s._gitContext}]},
        parent_tool_use_id: null,
    })
    log.info({sessionId: sessionId?.slice(0, 8)}, 'git-context 已注入')
}

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

// ── 定时任务调度（模块级状态）──
const SCHEDULED_TASKS_FILE = join(BRIDGE_HOME, 'bridge-scheduled-tasks.json')
const scheduledTasks = readJSON(SCHEDULED_TASKS_FILE) || {}
const cronJobs = new Map()
const scheduledRuns = new Map()
const MAX_SCHEDULED_CONCURRENT = Math.min(8, Math.max(1, parseInt(process.env.BRIDGE_SCHEDULED_MAX_CONCURRENT || '2', 10) || 2))
const MAX_SCHEDULED_DURATION_MS = Math.min(24 * 60 * 60 * 1000, Math.max(60_000,
    parseInt(process.env.BRIDGE_SCHEDULED_MAX_DURATION_MS || String(30 * 60 * 1000), 10) || 30 * 60 * 1000))
const MAX_OCR_CONCURRENT = Math.min(4, Math.max(1, parseInt(process.env.BRIDGE_OCR_MAX_CONCURRENT || '1', 10) || 1))
let activeOcr = 0

function finishScheduledRun(id) {
    const run = scheduledRuns.get(id)
    if (!run) return
    if (run.timer) clearTimeout(run.timer)
    scheduledRuns.delete(id)
}

function taskCompletionEventForClient(s, sessionId, type, extra = {}) {
    const identity = s?.taskCompletionIdentity || null
    const sequence = (s._taskCompletionSequence = (s._taskCompletionSequence || 0) + 1)
    const taskId = s?.taskCompletionTaskId || `${sessionId}:${s?.taskCompletionTurnId || 'task'}`
    const turnId = s?.taskCompletionTurnId || s?.activeTurnId || null
    if (s && ['task_completed', 'task_failed', 'task_review_paused'].includes(type) && !s.taskCompletedAt) {
        s.taskCompletedAt = Date.now()
    }
    updateTaskState(s, sessionId, taskStateFromCompletion(s))
    const taskState = taskStateForSessionClient(s)
    broadcastTurn(sessionId, {
        type,
        taskId,
        turnId,
        required: Boolean(s?.taskCompletion?.reviewPlan?.required),
        status: taskState.status,
        outcome: taskState.outcome,
        sequence,
        timestamp: Date.now(),
        startedAt: taskState.startedAt,
        durationMs: taskState.durationMs,
        notificationId: `${taskId}:${type}`,
        taskState,
        ...extra,
    }, identity)
    broadcastTaskLifecycle(sessionId)
}

async function applyTaskCompletionEffects(sessionId, effects = []) {
    const s = sessions.get(sessionId)
    if (!s) return
    for (const effect of effects) {
        if (effect.type === 'start_review') {
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
            if (!s.pushStream || s.taskCompletion?.fixAttempts !== 1) continue
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
                findings || '- 审查返回了未结构化的阻断问题，请检查本轮变更并修复真实问题。',
            ].join('\n')
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
            updateTaskState(s, sessionId, taskStateFromCompletion(s, effect.detail))
            taskCompletionEventForClient(s, sessionId, 'task_completed', {
                reply: s.taskFinalReplyText || s.taskState?.finalReplyText || '',
                review: s.taskCompletion?.reviewOutcome || null,
            })
            try {
                const notification = await maybeMirror(sessionId, {outcome: 'succeeded'}, `${s.taskCompletionTaskId || sessionId}:task_completed`)
                if (notification.failed === 0 && notification.pending === 0) {
                    updateTaskCompletion(s, sessionId, {type: 'notification_sent'})
                }
            } catch (error) {
                log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '最终完成镜像失败')
            }
        } else if (effect.type === 'fail' || effect.type === 'pause') {
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

/**
 * 空白会话只在第一条消息判断一次跨会话接力。内部上下文送入 SDK，
 * checkpoint、IM echo 和前端气泡仍保留用户原文。
 */
function resolveSdkInputContent(sessionId, session, prompt) {
    if (!session) return prompt
    let content = prompt
    if (!session.hasUserTurns && !session._continuationResolved) {
        session._continuationResolved = true
        try {
            const transcripts = listProjectTranscriptCandidates({
                bridgeHome: BRIDGE_HOME,
                encodedDir: encodeProjectName(session.workDir),
                workDir: session.workDir,
                stateStore: bridgeStateDb,
            })
            const context = buildProjectContinuationContext({
                prompt,
                currentSessionId: session.lastSessionId || null,
                transcripts,
            })
            if (context) {
                log.info({
                    sessionId: sessionId?.slice(0, 8),
                    sourceSessionId: context.sourceSessionId?.slice(0, 8),
                    contextLength: context.text.length,
                }, '已按需注入项目会话接力上下文')
                content = composeContinuationPrompt(prompt, context)
            }
        } catch (error) {
            log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '项目会话接力上下文读取失败，已按原消息继续')
        }
    }
    let enriched
    try {
        enriched = userPreferences.inject(session.workDir, content, prompt)
    } catch (error) {
        enriched = content
        log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '用户偏好读取失败，已按原消息继续')
    }
    try {
        const memory = memoryService?.retrieve({
            workDir: session.workDir,
            encodedDir: encodeProjectName(session.workDir),
            text: prompt,
        })
        if (memory?.text) {
            log.info({sessionId: sessionId?.slice(0, 8), itemCount: memory.items.length, memoryReason: memory.reason}, '已按需注入项目 Memory')
            enriched = `${memory.text}\n\n${enriched}`
        }
    } catch (error) {
        log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '项目 Memory 读取失败，已按原消息继续')
    }
    return enriched
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
    const task = scheduledTasks[id]
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
    const body = {
        workDir: task.workDir,
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
    scheduledSession.taskCompletionDecision = scheduledSession.taskDecision
    scheduledSession.taskCompletionTurnId = crypto.randomUUID()
    scheduledSession.taskCompletionTaskId = `${sessionId}:${scheduledSession.taskCompletionTurnId}`
    appendSessionEvent(scheduledSession, 'task/accepted', {
        source: 'scheduled', turnId: scheduledSession.taskCompletionTurnId, taskId: scheduledSession.taskCompletionTaskId,
    }, {critical: true})
    scheduledSession._taskCompletionSequence = 0
    updateTaskState(scheduledSession, sessionId, taskStateFromCompletion(scheduledSession))
    markInternalInput(scheduledSession, scheduledSession.taskDecision)
    pushStream.push({
        type: 'user', session_id: sessionId,
        message: {role: 'user', content: [{type: 'text', text: task.prompt}]},
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
    for (const [id, task] of Object.entries(scheduledTasks)) {
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

// ── 用户消息工作流自动匹配 ──
// 统一任务决策器是主事实源；旧路径缺少决策时仅使用本地关键词兼容，不再发起二次模型分类。
// 任务类型 → 模型等级映射 (power=最强, balanced=均衡, light=轻量)
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
    const exists = wfList.some(w => w.name.replace('.mjs', '') === matchedWf)
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
            log.warn({err: error, sessionId: sessionId?.slice(0, 8), workflow: matchedWf}, '自动 Workflow 预注册失败')
        }
        return
    }
    log.info({sessionId: sessionId?.slice(0, 8), workflow: matchedWf, wfId}, '自动启动 workflow')
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
        _workflowTier: workflowTier,
        _modelTiers: wfCfg.modelTiers || {},
        _fixedModel: sessions.get(sessionId)?.modelMode === 'fixed'
            ? sessions.get(sessionId)?.queryOpts?.model || null
            : null,
        _taskDecision: taskDecision || null,
        _taskOwned: true,
        _runKey: `${matchedWf}:${sessionId}`,
    }).catch(e => {
        log.error({err: e, sessionId: sessionId?.slice(0, 8), workflow: matchedWf}, '自动 workflow 失败')
    })
}

// ── 供应商预设常量（模块级，供 /api/config/providers 和 lookupModelInfo 共用）──
const PROVIDERS = [
    {
        id: 'deepseek', name: 'DeepSeek', icon: 'D',
        baseUrl: 'https://api.deepseek.com/anthropic',
        officialUrl: 'https://platform.deepseek.com',
        docsUrl: 'https://api-docs.deepseek.com',
        models: [
            {id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: '1M'},
            {id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: '256K'},
            {id: 'deepseek-chat', name: 'DeepSeek Chat', contextWindow: '128K'},
            {id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', contextWindow: '128K'},
        ],
        pricing: {input: '4 CNY/1M tokens', output: '16 CNY/1M tokens'},
    },
    {
        id: 'zhipu', name: '智谱AI', icon: 'Z',
        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
        officialUrl: 'https://open.bigmodel.cn',
        docsUrl: 'https://docs.bigmodel.cn',
        models: [
            {id: 'glm-5.2', name: 'GLM-5.2', contextWindow: '128K'},
            {id: 'glm-5.1', name: 'GLM-5.1', contextWindow: '128K'},
            {id: 'glm-5', name: 'GLM-5', contextWindow: '128K'},
            {id: 'glm-4.7', name: 'GLM-4.7', contextWindow: '128K'},
            {id: 'glm-4.6', name: 'GLM-4.6', contextWindow: '128K'},
            {id: 'glm-4.5', name: 'GLM-4.5', contextWindow: '128K'},
            {id: 'glm-4-flash', name: 'GLM-4-Flash', contextWindow: '128K'},
        ],
        pricing: {input: '1 CNY/1M tokens', output: '4 CNY/1M tokens'},
    },
    {
        id: 'moonshot', name: 'Kimi 月之暗面', icon: 'K',
        baseUrl: 'https://api.moonshot.ai/anthropic',
        officialUrl: 'https://platform.kimi.ai',
        docsUrl: 'https://platform.kimi.ai/docs',
        models: [
            {id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: '256K'},
            {id: 'kimi-k2.5', name: 'Kimi K2.5', contextWindow: '256K'},
            {id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', contextWindow: '256K'},
        ],
        pricing: {input: '0.95 USD/1M tokens', output: '4 USD/1M tokens'},
    },
    {
        id: 'opencode', name: 'OpenCode', icon: 'OC',
        baseUrl: 'https://opencode.ai/zen/v1',
        officialUrl: 'https://opencode.ai',
        docsUrl: 'https://opencode.ai/docs',
        models: [
            {id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: '1M'},
            {id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: '256K'},
            {id: 'glm-5.2', name: 'GLM-5.2', contextWindow: '128K'},
            {id: 'glm-5.1', name: 'GLM-5.1', contextWindow: '128K'},
            {id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', contextWindow: '256K'},
            {id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: '256K'},
            {id: 'kimi-k2.5', name: 'Kimi K2.5', contextWindow: '256K'},
            {id: 'minimax-m2.7', name: 'MiniMax M2.7', contextWindow: '256K'},
            {id: 'minimax-m2.5', name: 'MiniMax M2.5', contextWindow: '256K'},
            {id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', contextWindow: '128K'},
            {id: 'mimo-v2.5', name: 'MiMo V2.5', contextWindow: '128K'},
            {id: 'qwen3.7-max', name: 'Qwen3.7 Max', contextWindow: '128K'},
            {id: 'qwen3.6-plus', name: 'Qwen3.6 Plus', contextWindow: '128K'},
            {id: 'qwen3.5-plus', name: 'Qwen3.5 Plus', contextWindow: '128K'},
        ],
        pricing: {input: '$10/月(Go)', output: 'Zen 按量'},
    },
    {
        id: 'anthropic', name: 'Anthropic', icon: 'A',
        baseUrl: 'https://api.anthropic.com',
        officialUrl: 'https://console.anthropic.com',
        docsUrl: 'https://docs.anthropic.com/en/api',
        models: [
            {id: 'claude-opus-4-5', name: 'Claude Opus 4.5', contextWindow: '200K'},
            {id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: '200K'},
            {id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: '200K'},
        ],
        pricing: {input: '15 USD/1M tokens', output: '75 USD/1M tokens'},
    },
    {
        id: 'qwen', name: '千问', icon: 'Q',
        baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
        officialUrl: 'https://bailian.console.aliyun.com',
        docsUrl: 'https://help.aliyun.com/zh/model-studio',
        models: [
            {id: 'qwen3-max', name: 'Qwen3 Max', contextWindow: '128K'},
            {id: 'qwen3.5-plus', name: 'Qwen3.5 Plus', contextWindow: '128K'},
            {id: 'qwen3.5-flash', name: 'Qwen3.5 Flash', contextWindow: '128K'},
            {id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus', contextWindow: '128K'},
        ],
        pricing: {input: '0.5 CNY/1M tokens', output: '2 CNY/1M tokens'},
    },
    {
        id: 'openrouter', name: 'OpenRouter', icon: 'R',
        baseUrl: 'https://openrouter.ai/api/v1',
        officialUrl: 'https://openrouter.ai',
        docsUrl: 'https://openrouter.ai/docs',
        models: [
            {id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', contextWindow: '200K'},
            {id: 'anthropic/claude-opus-4', name: 'Claude Opus 4', contextWindow: '200K'},
            {id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: '1M'},
            {id: 'openai/gpt-5', name: 'GPT-5', contextWindow: '128K'},
            {id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', contextWindow: '128K'},
        ],
        pricing: {input: '按模型不同', output: '聚合定价'},
    },
    {
        id: 'ollama', name: 'Ollama (本地)', icon: 'O',
        baseUrl: 'http://localhost:11434/v1',
        officialUrl: 'https://ollama.com',
        docsUrl: 'https://ollama.com/docs',
        models: [
            {id: 'qwen3', name: 'Qwen 3', contextWindow: '32K'},
            {id: 'llama4', name: 'Llama 4', contextWindow: '128K'},
            {id: 'deepseek-r1', name: 'DeepSeek R1', contextWindow: '128K'},
            {id: 'codestral', name: 'Codestral', contextWindow: '256K'},
        ],
        pricing: {input: '本地免费', output: '不限量'},
    },
    {
        id: 'volcengine', name: '火山引擎', icon: 'V',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        officialUrl: 'https://console.volcengine.com/ark',
        docsUrl: 'https://www.volcengine.com/docs/82379',
        models: [
            {id: 'doubao-seed-1.6', name: '豆包 Seed 1.6', contextWindow: '128K'},
            {id: 'doubao-seed-1.6-flash', name: '豆包 Flash 1.6', contextWindow: '128K'},
            {id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: '1M'},
            {id: 'deepseek-r1-0528', name: 'DeepSeek R1', contextWindow: '128K'},
        ],
        pricing: {input: '0.8 CNY/1M tokens', output: '2 CNY/1M tokens'},
    },
    {
        id: 'gemini', name: 'Gemini', icon: 'G',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        officialUrl: 'https://ai.google.dev',
        docsUrl: 'https://ai.google.dev/gemini-api/docs',
        models: [
            {id: 'gemini-3-pro', name: 'Gemini 3 Pro', contextWindow: '1M'},
            {id: 'gemini-3-flash', name: 'Gemini 3 Flash', contextWindow: '1M'},
            {id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: '1M'},
            {id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: '1M'},
        ],
        pricing: {input: '0.15 USD/1M tokens', output: '0.60 USD/1M tokens'},
    },
    {
        id: 'minimax', name: 'MiniMax', icon: 'M',
        baseUrl: 'https://api.minimaxi.com/anthropic',
        officialUrl: 'https://platform.minimaxi.com',
        docsUrl: 'https://platform.minimax.io/docs/api',
        models: [
            {id: 'MiniMax-M3', name: 'MiniMax M3', contextWindow: '512K'},
            {id: 'MiniMax-M2.7', name: 'MiniMax M2.7', contextWindow: '205K'},
            {id: 'MiniMax-M2.5', name: 'MiniMax M2.5', contextWindow: '205K'},
            {id: 'MiniMax-M2.1', name: 'MiniMax M2.1', contextWindow: '1M'},
            {id: 'MiniMax-M2.1-Lightning', name: 'MiniMax M2.1 Lightning', contextWindow: '1M'},
        ],
        pricing: {input: '0.30 USD/1M tokens', output: '1.20 USD/1M tokens'},
    },
    {
        id: 'codex-relay', name: 'AICodeMirror Codex', icon: 'CM',
        baseUrl: 'https://api.claudecode.net.cn/api/codex/backend-api/codex',
        officialUrl: 'https://www.aicodemirror.ai',
        docsUrl: 'https://www.aicodemirror.ai',
        models: [
            {id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', contextWindow: '256K'},
            {id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', contextWindow: '256K'},
            {id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: '256K'},
        ],
        pricing: {input: '按 AICodeMirror 账户计费', output: '按 AICodeMirror 账户计费'},
    },
    {
        id: 'codex', name: 'Codex', icon: 'X',
        baseUrl: 'https://api.openai.com/v1',
        officialUrl: 'https://github.com/openai/codex',
        docsUrl: 'https://github.com/openai/codex',
        models: [
            {id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', contextWindow: '200K'},
            {id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', contextWindow: '200K'},
            {id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', contextWindow: '200K'},
        ],
        pricing: {input: '3 USD/1M tokens', output: '15 USD/1M tokens'},
    },
    {
        id: 'custom', name: '自定义', icon: '···',
        baseUrl: '',
        officialUrl: '',
        docsUrl: '',
        models: [],
        pricing: {input: '', output: ''},
    },
];

/** 解析 contextWindow 字符串为 token 数（如 '1M' → 1000000, '128K' → 128000） */
function parseContextWindow(cw) {
    return parseTokenCount(cw)
}

/** 解析 pricing 字符串提取价格数字和货币 */
function parsePricingPrice(s) {
    if (!s) return null;
    const m = /^([\d.]+)\s*(CNY|USD|EUR|GBP|JPY)/i.exec(String(s));
    if (!m) return null;
    return {price: parseFloat(m[1]), currency: m[2].toUpperCase()};
}

/** 根据模型 ID 查找 contextWindow 和定价 */
function lookupModelInfo(modelId) {
    const fallback = {contextWindow: null, pricing: null};
    for (const p of PROVIDERS) {
        for (const m of p.models) {
            if (m.id === modelId) {
                const cw = parseContextWindow(m.contextWindow);
                const inp = parsePricingPrice(p.pricing?.input);
                const out = parsePricingPrice(p.pricing?.output);
                return {
                    contextWindow: cw,
                    pricing: (inp && out) ? {inputPrice: inp.price, outputPrice: out.price, currency: inp.currency} : null,
                };
            }
        }
    }
    return fallback;
}

// ---- HTTP server ----
// ── HTTP REST API 服务器 ──
// 功能说明: 统一 HTTP 入口，处理所有前端 REST API 请求（会话管理/配置CRUD/微信发送/确认响应/项目扫描/文件Diff等）
//   所有响应均为 JSON（Content-Type: application/json），所有路由都有 CORS 头
// 实现方式: 单 createServer 回调 + URL pathname 匹配 + method 检查；路由按 pathname 分组（sessions/config/wechat/confirm/projects）
//   匹配失败返回 404
// 关键数据流: HTTP request → URL pathname 匹配 → method dispatch → JSON response
async function handleHttpRequest(req, res) {
    res.setHeader('X-Source', 'github.com/kankancuige/claude-desktop-bridge')
    const httpStart = Date.now()
    // 拦截 res.end，记录 HTTP 请求日志
    const _end = res.end.bind(res)
    res.end = function (...args) {
        logHttpRequest(log, req, res.statusCode, httpStart)
        return _end(...args)
    }
    // 动态白名单 CORS: 仅本机 renderer(file://→null origin / dev localhost)放行
    // 跨域网页(malicious.com)不返 CORS 头 → 浏览器默认同源策略挡住读响应
    const origin = req.headers.origin
    const safeOrigin = (!origin || origin === 'null'
        || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
    if (safeOrigin) {
        res.setHeader('Access-Control-Allow-Origin', origin || 'null')
        res.setHeader('Vary', 'Origin')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-bridge-token, x-bridge-source, x-bridge-user-id')
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return
    }
    // URL 解析需提前到认证之前（认证白名单依赖 pathname）
    let url
    try {
        url = new URL(req.url, `http://127.0.0.1:${PORT}`)
    } catch {
        res.writeHead(400)
        res.end(JSON.stringify({error: 'invalid request URL'}))
        return
    }
    // 本地 API 默认全部校验 token，浏览器、Electron 和内部适配器使用同一认证规则。
    // /api/bridge-token 仅用于显式开启的浏览器开发模式，生产环境不暴露运行凭据。
    const isTokenEndpoint = req.method === 'GET' && url.pathname === '/api/bridge-token'
    let requestAuth = null
    if (isTokenEndpoint) {
        if (!ALLOW_TOKEN_ENDPOINT) {
            res.writeHead(404)
            res.end(JSON.stringify({error: 'not found'}))
            return
        }
    } else {
        requestAuth = authenticateBridgeToken(req.headers['x-bridge-token'])
        if (!requestAuth) {
            res.writeHead(403)
            res.end(JSON.stringify({error: 'forbidden: missing or invalid bridge token'}))
            return
        }
    }
    const requestIdentity = getAdapterIdentity(req)
    if (requestAuth?.kind === 'adapter') {
        if (!requestIdentity || requestIdentity.source !== requestAuth.platform) {
            res.writeHead(403); res.end(JSON.stringify({error: 'adapter identity mismatch'})); return
        }
        if (!adapterRouteAllowed(req.method, url.pathname, requestAuth.platform)) {
            res.writeHead(403); res.end(JSON.stringify({error: 'adapter route not allowed'})); return
        }
    }
    if (requestIdentity) {
        if (url.pathname === '/api/sessions' || url.pathname.startsWith('/api/workflows')) {
            res.writeHead(403); res.end(JSON.stringify({error: 'adapter route not allowed'})); return
        }
        const sessionRoute = url.pathname.match(/^\/api\/sessions\/([^/]+)/)
        if (sessionRoute && !['resolve', 'focused'].includes(sessionRoute[1])
            && !adapterOwnsSession(requestIdentity.source, requestIdentity.userId, sessionRoute[1])) {
            res.writeHead(403); res.end(JSON.stringify({error: 'session ownership mismatch'})); return
        }
    }
    res.setHeader('Content-Type', 'application/json')

    // GET /api/bridge-token —— 非 Electron 环境(dev/browser)读取本地认证 token
    if (url.pathname === '/api/bridge-token' && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({token: BRIDGE_TOKEN}));
        return
    }

    // 用户偏好管理：偏好与规则文件分离，避免一次性要求污染长期规则。
    if (req.method === 'GET' && url.pathname === '/api/preferences') {
        res.writeHead(200)
        res.end(JSON.stringify(userPreferences.listAll()))
        return
    }
    const prefSuggestionM = url.pathname.match(/^\/api\/preferences\/suggestions\/([^/]+)\/respond$/)
    if (req.method === 'POST' && prefSuggestionM) {
        const body = await readBody(req)
        if (body._bodyTooLarge || body._bodyError || body._parseError || !isDirectoryPath(body.projectDir)) {
            res.writeHead(400)
            res.end(JSON.stringify({error: 'invalid preference request'}))
            return
        }
        try {
            const result = userPreferences.respond({
                projectDir: body.projectDir,
                suggestionId: safeDecodeURIComponent(prefSuggestionM[1]),
                action: body.action,
            })
            res.writeHead(200)
            res.end(JSON.stringify(result))
        } catch (error) {
            res.writeHead(error.code === 'PREFERENCE_SUGGESTION_NOT_FOUND' ? 404 : 400)
            res.end(JSON.stringify({error: error.message, code: error.code || 'PREFERENCE_RESPONSE_FAILED'}))
        }
        return
    }
    const prefM = url.pathname.match(/^\/api\/preferences\/(global|project)\/([^/]+)$/)
    if ((req.method === 'PUT' || req.method === 'DELETE') && prefM) {
        const scope = prefM[1]
        const id = safeDecodeURIComponent(prefM[2])
        const body = (req.method === 'PUT' || req.method === 'DELETE') ? await readBody(req) : {}
        const encodedDir = scope === 'project'
            ? safeDecodeURIComponent(body.encodedDir || url.searchParams.get('encodedDir') || '')
            : ''
        if (scope === 'project' && (!encodedDir || basename(encodedDir) !== encodedDir)) {
            res.writeHead(400)
            res.end(JSON.stringify({error: 'project preference requires encodedDir'}))
            return
        }
        try {
            const result = req.method === 'PUT'
                ? userPreferences.update({scope, id, enabled: body.enabled !== false, encodedDir})
                : userPreferences.remove({scope, id, encodedDir})
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, preference: result}))
        } catch (error) {
            res.writeHead(error.code === 'PREFERENCE_NOT_FOUND' ? 404 : 400)
            res.end(JSON.stringify({error: error.message, code: error.code || 'PREFERENCE_MUTATION_FAILED'}))
        }
        return
    }

    // ── POST /api/sessions —— 创建/恢复会话 ──
    // 功能说明: 创建一个新的 Claude Code SDK query 会话，或通过 resume 恢复已有会话
    //   完成以下初始化链：PushStream → query() → sessions Map → 文件快照基线 → 记录点恢复 → startStreamPump
    // 实现方式:
    //   1. body.workDir 必填，sessionId = body.resume 或 crypto.randomUUID()
    //   2. loadCliSettings + makeQueryOptions 组装 SDK query options
    //   3. 创建 PushStream 作为 prompt 输入，通过 Agent Provider 启动 SDK query
    //   4. 存入 sessions Map（含 query/工作目录/pending/权限模式/mirrors 等）
    //   5. 恢复或新建文件快照基线（loadSnapshot / buildFileSnapshot）
    //   6. 恢复历史记录点（loadCheckpoints）
    //   7. 设为 focusedSessionId + 启动 startStreamPump
    // 关键数据流: POST {workDir, resume?, model?, ...} → PushStream → query() → sessions.set()
    //   → snapshot + checkpoints 恢复 → startStreamPump() → 201 {sessionId, workDir, resumed}
    if (req.method === 'POST' && url.pathname === '/api/sessions') {
        const body = await readBody(req);
        if (body._bodyTooLarge || body._bodyError || body._parseError) {
            res.writeHead(body._bodyTooLarge ? 413 : 400)
            res.end(JSON.stringify({error: body._bodyTooLarge ? 'payload too large' : 'invalid JSON'}))
            return
        }
        if (typeof body.workDir !== 'string'
            || (body.resume !== undefined && !isValidSessionId(body.resume))
            || (body.forkFrom !== undefined && !isValidSessionId(body.forkFrom))
            || (body.permissionMode !== undefined && !VALID_PERMISSION_MODES.has(body.permissionMode))
            || (body.thinkingLevel !== undefined && !VALID_THINKING_LEVELS.has(body.thinkingLevel))
            || (body.modelMode !== undefined && !VALID_MODEL_MODES.has(body.modelMode))
            || (body.model !== undefined && (typeof body.model !== 'string' || body.model.length > 256))
            || (body.maxTurns !== undefined && (!Number.isFinite(Number(body.maxTurns)) || Number(body.maxTurns) < 1 || Number(body.maxTurns) > 100))
            || (body.baseUrl !== undefined && (typeof body.baseUrl !== 'string' || body.baseUrl.length > 2048))
            || (body.apiKey !== undefined && (typeof body.apiKey !== 'string' || body.apiKey.length > 8192))) {
            res.writeHead(400)
            res.end(JSON.stringify({error: 'invalid session parameters'}))
            return
        }
        // 规范化 workDir 消除编码歧义（双斜杠/反斜杠/末尾斜杠等）
        const workDir = normalizeWorkDir(body.workDir || '')
        if (!isDirectoryPath(workDir)) {
            res.writeHead(400);
            res.end(JSON.stringify({error: 'workDir must be an existing directory'}));
            return
        }
        let createMode
        try {
            createMode = resolveSessionCreateMode(body)
        } catch (error) {
            res.writeHead(400)
            res.end(JSON.stringify({error: error.message, code: 'SESSION_CREATE_MODE_INVALID'}))
            return
        }
        let sessionId = crypto.randomUUID()
        let resumeSid = null  // 传给 SDK 的 conversation ID，null = 不 resume
        let forkedFrom = null
        let forkSourceId = null
        if (createMode.mode === 'fork') {
            const encDir = encodeProjectName(workDir)
            const sourceTranscript = findSessionTranscript({
                bridgeHome: BRIDGE_HOME,
                encodedDir: encDir,
                sessionId: createMode.sourceSessionId,
                workDir,
            })
            if (sourceTranscript.status !== 'found') {
                res.writeHead(404)
                res.end(JSON.stringify({
                    error: '分支源会话不存在或 transcript 已损坏',
                    code: 'SESSION_FORK_SOURCE_NOT_FOUND',
                }))
                return
            }
            forkSourceId = createMode.sourceSessionId
        } else if (createMode.mode === 'resume') {
            const encDir = encodeProjectName(workDir)
            const requestedTranscript = findSessionTranscript({
                bridgeHome: BRIDGE_HOME,
                encodedDir: encDir,
                sessionId: body.resume,
                workDir,
            })
            const transcriptExists = requestedTranscript.status === 'found'
            let activeRuntime = null
            for (const [candidateId, candidate] of sessions) {
                if (normalizeWorkDir(candidate?.workDir).toLowerCase() !== workDir.toLowerCase()) continue
                if (candidateId === body.resume || candidate?.lastSessionId === body.resume) {
                    activeRuntime = {gatewaySessionId: candidateId, sdkSessionId: candidate.lastSessionId || null}
                    break
                }
            }
            const mappedSdkCandidate = lookupSdkSessionId(workDir, body.resume)
            const mappedSdkTranscript = mappedSdkCandidate
                ? findSessionTranscript({bridgeHome: BRIDGE_HOME, encodedDir: encDir, sessionId: mappedSdkCandidate, workDir})
                : null
            const mappedGatewayCandidate = transcriptExists ? lookupGatewaySessionId(workDir, body.resume) : null
            const mappedRuntime = mappedGatewayCandidate ? sessions.get(mappedGatewayCandidate) : null
            const mappedRuntimeSdkId = mappedRuntime?.lastSessionId || mappedRuntime?.queryOpts?.resume || null
            const reusableMappedGateway = !mappedRuntime || mappedRuntimeSdkId === body.resume
                ? mappedGatewayCandidate
                : null
            const resolution = resolveSessionResume({
                requestedResume: body.resume,
                activeGatewaySessionId: activeRuntime?.gatewaySessionId,
                activeSdkSessionId: activeRuntime?.sdkSessionId,
                mappedSdkSessionId: mappedSdkTranscript?.status === 'found' ? mappedSdkCandidate : null,
                mappedGatewaySessionId: reusableMappedGateway,
                transcriptExists,
                newGatewaySessionId: sessionId,
            })
            if (resolution.mode === 'missing') {
                log.warn({resume: body.resume.slice(0, 8), workDir}, 'session resume 目标不存在')
                res.writeHead(404)
                res.end(JSON.stringify({
                    error: '历史会话不存在或 transcript 已损坏',
                    code: 'SESSION_RESUME_NOT_FOUND',
                }))
                return
            }
            sessionId = resolution.gatewaySessionId
            resumeSid = resolution.sdkSessionId
        }
        // 重启后前端旧快照通常仍会带 default；已有会话的非 default 权限以服务端持久化值为准。
        // 用户在会话中主动切回 default 后，持久化值也会变为 default，不会阻止后续切换。
        const persistedCatalogKey = sessionCatalogProjectKey(workDir)
        const persistedCatalogIds = createMode.mode === 'resume'
            ? [body.resume, lookupSdkSessionId(workDir, body.resume)]
            : createMode.mode === 'fork' ? [forkSourceId] : []
        const persistedCatalogState = bridgeStateDb?.available
            ? persistedCatalogIds.map(id => id ? bridgeStateDb.getSessionCatalog(persistedCatalogKey, id) : null).find(Boolean) || null
            : null
        const persistedPermissionState = createMode.mode === 'resume'
            ? (loadTaskState(workDir, resumeSid || body.resume) || null)
            : createMode.mode === 'fork'
                ? (loadTaskState(workDir, forkSourceId) || null)
                : null
        const persistedPermissionMode = VALID_PERMISSION_MODES.has(persistedPermissionState?.permissionMode)
            ? persistedPermissionState.permissionMode
            : VALID_PERMISSION_MODES.has(persistedCatalogState?.permissionMode)
                ? persistedCatalogState.permissionMode
            : null
        if (persistedPermissionMode && persistedPermissionMode !== 'default' && body.permissionMode === 'default') {
            body.permissionMode = persistedPermissionMode
        }
        try {
            const cliS = loadCliSettings();
            const pushStream = new PushStream()
            // 新会话先使用轻量上下文；恢复/分支会话必须保留完整工具和项目上下文。
            body.contextProfile = createMode.mode === 'new' ? 'light' : 'full'
            const opts = await makeQueryOptions(body, workDir, cliS, {}, sessionId)
            if (forkSourceId) {
                try {
                    // 配置和代理初始化成功后才复制 transcript，减少失败时产生孤儿 fork。
                    // 不传 dir：兼容旧版本把 Unicode 项目写入错误编码目录的 transcript。
                    const forked = await forkSession(forkSourceId)
                    resumeSid = forked?.sessionId || null
                    if (!resumeSid || !isValidSessionId(resumeSid)) throw new Error('SDK 未返回有效的分支会话 ID')
                    forkedFrom = forkSourceId
                } catch (error) {
                    log.error({err: error, sourceSessionId: forkSourceId.slice(0, 8), workDir}, 'Session 分支失败')
                    res.writeHead(500)
                    res.end(JSON.stringify({error: '无法从源会话创建分支', code: 'SESSION_FORK_FAILED'}))
                    return
                }
            }
            if (resumeSid) {
                opts.resume = resumeSid
            }
            // 若 sessionId 已有活跃会话（query 仍在运行、仍有客户端连接），
            // 直接复用，不销毁重建——否则会中断正在进行的对话 + 导致重复 session
            const oldSess = sessions.get(sessionId)
            if (oldSess?.query && oldSess?.pushStream) {
                restoreSessionMirrors(oldSess, sessionId)
                persistSessionCatalogSettings(oldSess, sessionId, {
                    permissionMode: oldSess.permissionMode,
                    mirrors: oldSess.mirrors,
                    lastOpenedAt: Date.now(),
                })
                focusedSessionId = sessionId
                res.writeHead(200);
                res.end(JSON.stringify({sessionId, workDir, resumed: true, historySessionId: oldSess.lastSessionId || resumeSid,
                    permissionMode: oldSess.permissionMode || 'default',
                    taskState: taskStateForClient(oldSess.taskState),
                    gitInfo: sessions.get(sessionId)?.snapshot?.gitHead || null}));
                return
            }
            const deferAutomaticQuery = createMode.mode === 'new' && shouldDeferAutomaticQuery({
                modelMode: opts.bridgeModelMode,
                hasTaskDecision: Boolean(opts.bridgeTaskDecision),
                hasConversationTarget: false,
            })
            const eventJournal = openSessionEventJournal(workDir, sessionId)
            const q = deferAutomaticQuery ? null : startClaudeAgent(pushStream, opts)
            // 清理已死的旧会话资源
            if (oldSess) {
                await closeSessionRuntime(oldSess, {sessionId, reason: 'replace_stale_session'})
                oldSess.query = null
                oldSess.pushStream = null
                oldSess.eventJournal?.close()
            }
            sessions.set(sessionId, createSessionRuntime({
                query: q,
                pushStream: deferAutomaticQuery ? null : pushStream,
                workDir,
                opts,
                identity: resumeSid,
                thinkingLevel: body.thinkingLevel || 'auto',
                modelMode: opts.bridgeModelMode || (body.model ? 'fixed' : 'auto'),
                agentName: body._agentName || 'main',
                depth: body._depth || 0,
                extra: {
                    eventJournal,
                    providerBaseUrl: opts.bridgeProviderBaseUrl || body.baseUrl || '',
                    forkedFrom,
                    modelMeta: body.modelMeta || null,
                    _gitContext: null,
                    snapshotReady: false,
                    checkpointsLoaded: false,
                },
            }))
            const createdSession = sessions.get(sessionId)
            const journalTaskProjection = resumeSid
                ? createdSession.eventJournal.projectTaskState({recoverRunning: true})
                : null
            const persistedTaskState = repairPersistedTaskState(resumeSid
                ? (loadTaskState(workDir, resumeSid) || journalTaskProjection || loadTaskState(workDir, sessionId))
                : null)
            createdSession.taskState = persistedTaskState || createTaskStatePatch({
                status: 'idle',
                outcome: null,
                continuationReason: null,
                resumable: false,
                sdkSessionId: resumeSid,
                historySessionId: resumeSid,
                permissionMode: createdSession.permissionMode,
            })
            if (VALID_PERMISSION_MODES.has(persistedTaskState?.permissionMode)
                && persistedTaskState.permissionMode !== 'default'
                && body.permissionMode === 'default') {
                createdSession.permissionMode = persistedTaskState.permissionMode
            }
            createdSession.taskState = createTaskStatePatch({
                ...createdSession.taskState,
                permissionMode: createdSession.permissionMode,
            })
            if (persistedTaskState && ['reviewing', 'changes_required', 'fixing', 'review_paused'].includes(persistedTaskState.status)) {
                const recoveredPhase = persistedTaskState.status === 'reviewing' || persistedTaskState.status === 'fixing'
                    ? 'review_paused'
                    : persistedTaskState.status
                createdSession.taskCompletion = createTaskCompletionState({
                    phase: recoveredPhase,
                    reviewRound: persistedTaskState.review?.round || 0,
                    reviewPlan: persistedTaskState.review?.tier ? {
                        required: true,
                        tier: persistedTaskState.review.tier,
                        mode: persistedTaskState.review.tier === 'power' ? 'gate' : 'focused',
                        riskDomains: ['correctness'],
                    } : null,
                    reviewOutcome: persistedTaskState.review ? {
                        passed: false,
                        blockingFindings: persistedTaskState.review.blockingFindings || [],
                        advisoryFindings: [],
                        summary: persistedTaskState.review.summary || '',
                        tier: persistedTaskState.review.tier || 'balanced',
                    } : null,
                    detail: recoveredPhase === 'review_paused'
                        ? 'Gateway 重启中断了最终审查，请继续当前任务以恢复处理。'
                        : persistedTaskState.detail || '',
                })
                createdSession.taskState = taskStateFromCompletion(createdSession, createdSession.taskCompletion.detail)
            }
            createdSession.taskCompletionTaskId = persistedTaskState?.taskId || null
            createdSession.taskCompletionTurnId = persistedTaskState?.turnId || null
            createdSession._taskCompletionSequence = persistedTaskState?.sequence || 0
            restoreSessionMirrors(createdSession, sessionId)
            createdSession.taskFinalReplyText = persistedTaskState?.finalReplyText || ''
            persistSessionCatalogSettings(createdSession, sessionId, {
                permissionMode: createdSession.permissionMode,
                mirrors: createdSession.mirrors,
                lastOpenedAt: Date.now(),
            })
            createdSession.visibleSource = sessionVisibilitySource(getProjectVisibility(workDir), sessionId, resumeSid)
            if (resumeSid && createdSession.taskState.status === 'running') {
                createdSession.taskState = recoverTaskState(createdSession.taskState)
            }
            saveTaskState(createdSession, sessionId)
            if (resumeSid && !persistSdkSessionId(workDir, sessionId, resumeSid)) {
                log.warn({sessionId: sessionId?.slice(0, 8), historySessionId: resumeSid.slice(0, 8)}, '恢复 Session 映射未立即持久化')
            }
            focusedSessionId = sessionId
            if (q) startStreamPump(sessionId)
            invalidateProjectsCache()
            res.writeHead(201);
            res.end(JSON.stringify({sessionId, workDir, resumed: createMode.mode === 'resume', forked: createMode.mode === 'fork', forkedFrom,
                permissionMode: sessions.get(sessionId)?.permissionMode || 'default',
                historySessionId: resumeSid,
                taskState: taskStateForClient(sessions.get(sessionId)?.taskState),
                gitInfo: sessions.get(sessionId)?.snapshot?.gitHead || null}))
            queueMicrotask(() => reconcileTaskNotificationIntents(sessionId, createdSession))
            // 响应并建立会话后再构建项目索引，不能让首次扫描阻塞 WebSocket/focus。
            scheduleProjectCacheBuild(workDir)
            const backgroundSession = sessions.get(sessionId)
            scheduleSessionBackgroundInitialization({
                sessionId,
                session: backgroundSession,
                getSession: id => sessions.get(id),
                loadSnapshot,
                buildSnapshot: buildFileSnapshot,
                saveSnapshot,
                buildGitContext,
                loadCheckpoints,
                log,
            })
        } catch (e) {
            log.error({err: e}, 'session 创建失败')
            if (!res.headersSent) {
                res.writeHead(500);
                res.end(JSON.stringify({error: String(e?.message || e)}))
            }
        }
        return
    }

    // ── POST /api/sessions/:id/stop —— 幂等停止当前生成，不删除 transcript ──
    const stopM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stop$/)
    if (req.method === 'POST' && stopM) {
        const requestedId = stopM[1]
        let id = requestedId
        let session = sessions.get(id)
        if (!session) {
            for (const [candidateId, candidate] of sessions) {
                if (candidate.lastSessionId === requestedId) {
                    id = candidateId
                    session = candidate
                    break
                }
            }
        }
        if (!session) {
            res.writeHead(404)
            res.end(JSON.stringify({error: '会话不存在', code: 'SESSION_NOT_FOUND'}))
            return
        }
        try {
            const result = await stopSessionGeneration(id, session)
            res.writeHead(200)
            res.end(JSON.stringify(buildSessionStopResponse(session, result)))
        } catch (error) {
            log.error({err: error, sessionId: id.slice(0, 8)}, '停止 Session 失败')
            res.writeHead(500)
            res.end(JSON.stringify({error: '停止会话失败', code: 'SESSION_STOP_FAILED'}))
        }
        return
    }

    // ── POST /api/sessions/resolve —— IM 接入 resolve 会话 ──
    // 功能说明: 微信/飞书/钉钉等 IM 平台在收到用户消息后，通过此接口关联到当前桌面端正打开的活跃 session
    //   复用 focusedSessionId，并将 platform:userId→sessionId 映射写入 adapter-sessions.json 用于后续消息路由
    // 实现方式:
    //   1. 检查 focusedSessionId 是否有效 → 有则复用，将 {platform, userId, sessionId, workDir, updatedAt} 写入绑定表
    //   2. 没有活跃 session → 返回 409 no_active_session，告知微信「请先在桌面端打开一个项目会话」
    // 关键数据流: POST {userId} + identity headers → focusedSessionId 查找 → 写入绑定表 → 200 {sessionId, reused:true}
    //   或 409 {error:'no_active_session'}
    if (req.method === 'POST' && url.pathname === '/api/sessions/resolve') {
        const body = await readBody(req);
        const userId = body.userId
        const identity = getAdapterIdentity(req)
        if (!identity || identity.userId !== userId) {
            res.writeHead(403)
            res.end(JSON.stringify({error: 'adapter identity mismatch'}))
            return
        }
        const ad = readAdapterBindings()
        // 微信注入 desktop 当前打开的窗口（遥控模式）：复用 focusedSessionId
        if (focusedSessionId && sessions.has(focusedSessionId)) {
            const s = sessions.get(focusedSessionId)
            if (userId) {
                const updatedBindings = upsertAdapterBinding(ad, {
                    userId,
                    platform: identity.source,
                    sessionId: focusedSessionId,
                    workDir: s.workDir,
                    updatedAt: Date.now(),
                }, ADAPTER_PLATFORMS)
                try {
                    writeAdapterBindings(updatedBindings)
                } catch (error) {
                    log.error({err: error, platform: identity.source}, 'IM Session 绑定写入失败')
                    res.writeHead(500)
                    res.end(JSON.stringify({error: 'adapter binding persist failed'}))
                    return
                }
            }
            res.writeHead(200);
            res.end(JSON.stringify({sessionId: focusedSessionId, workDir: s.workDir, reused: true}));
            return
        }
        // desktop 没有打开任何窗口 → 明确告知微信「没有活跃的 session」
        res.writeHead(409);
        res.end(JSON.stringify({
            error: 'no_active_session',
            message: '当前没有活跃的 session，请先在桌面端打开一个项目会话'
        }))
        return
    }

    // ── GET /api/sessions —— 列出所有活跃 session ──
    // 功能说明: 返回网关内存中当前所有活跃 session 的摘要（id/工作目录/创建时间/连接数）
    // 关键数据流: GET → sessions Map → 200 {sessions: [...], total}
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
        const list = [...sessions.entries()].map(([id, s]) => ({
            id,
            workDir: s.workDir,
            createdAt: s.createdAt,
            clientCount: s.clients.size
        }));
        res.writeHead(200);
        res.end(JSON.stringify({sessions: list, total: list.length}));
        return
    }
    // ── GET /api/sessions/focused —— 获取当前聚焦 session ──
    // 功能说明: 返回当前 focusedSessionId 对应的 session 信息，无则 404
    //   用于外部模块（如 IM 适配器）判断当前是否有活跃的桌面会话
    // 关键数据流: GET → focusedSessionId 查找 → 200 {sessionId, workDir} 或 404
    if (req.method === 'GET' && url.pathname === '/api/sessions/focused') {
        const identity = getAdapterIdentity(req)
        if (identity && !adapterOwnsFocusedSession(identity)) {
            res.writeHead(403); res.end(JSON.stringify({error: 'session ownership mismatch'})); return
        }
        if (focusedSessionId && sessions.has(focusedSessionId)) {
            const s = sessions.get(focusedSessionId);
            res.writeHead(200);
            res.end(JSON.stringify({sessionId: focusedSessionId, workDir: s.workDir}))
        } else {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'no focused session'}))
        }
        ;
        return
    }
    // ── POST /api/sessions/:id/focus —— 切换聚焦会话 ──
    // 功能说明: 多标签页切换时，通知 Gateway 更新 focusedSessionId，
    //   确保 IM 消息（微信/飞书/钉钉）注入到当前查看的标签页对应会话
    // 关键数据流: POST /api/sessions/:id/focus → focusedSessionId = sid → 200 {ok:true}
    if (req.method === 'POST' && url.pathname.startsWith('/api/sessions/') && url.pathname.endsWith('/focus')) {
        const sid = url.pathname.split('/')[3]
        if (!sessions.has(sid)) { res.writeHead(404); res.end(JSON.stringify({error: 'session not found'})); return }
        focusedSessionId = sid
        res.writeHead(200); res.end(JSON.stringify({ok: true, focused: sid.slice(0, 8)}))
        return
    }
    // ── POST /api/desktop/nudge —— IM 控制命令中继到桌面端 ──
    // 功能说明: 微信/飞书/钉钉发送控制命令后，通过此接口将命令广播给所有 desktop WS 客户端
    //   桌面端收到 nudge 事件后执行对应 UI 操作（切换项目、新建 session、镜像开关、停止 agent）
    // body: { action: 'switch_project'|'new_session'|'switch_session'|'toggle_mirror'|'stop', args: {...}, source?: string }
    // 关键数据流: POST → 遍历 sessions → 广播给 source=desktop 的 WS → 200 {ok, delivered, nudgeId}
    if (req.method === 'POST' && url.pathname === '/api/desktop/nudge') {
        const identity = getAdapterIdentity(req)
        if (identity && !adapterOwnsFocusedSession(identity)) {
            res.writeHead(403); res.end(JSON.stringify({error: 'session ownership mismatch'})); return
        }
        const body = await readBody(req)
        if (!NUDGE_ACTIONS.has(body.action) || !body.args || typeof body.args !== 'object' || Array.isArray(body.args)) {
            res.writeHead(400); res.end(JSON.stringify({error: 'invalid nudge'})); return
        }
        const nudge = {type: 'nudge', action: body.action, args: body.args || {}, nudgeId: crypto.randomUUID(), source: body.source || 'hook'}
        let delivered = false
        const directAdapterStop = body.action === 'stop' && identity && focusedSessionId && sessions.has(focusedSessionId)
        let stopped = false
        if (directAdapterStop) {
            const result = await stopSessionGeneration(focusedSessionId, sessions.get(focusedSessionId))
            stopped = result.stopped
            delivered = stopped
        } else {
            // 先发给控制通道（桌面端无 session 时也能收到）
            for (const ws of controlClients) {
                if (ws.readyState === 1) { ws.send(JSON.stringify(nudge)); delivered = true }
            }
            // 再发给所有 session 级的 desktop 客户端
            for (const [, s] of sessions) {
                for (const ws of s.clients) {
                    if (ws._source === 'desktop' && ws.readyState === 1) { ws.send(JSON.stringify(nudge)); delivered = true }
                }
            }
        }
        res.writeHead(200); res.end(JSON.stringify({ok: true, delivered, stopped, nudgeId: nudge.nudgeId}))
        return
    }

    const delM = url.pathname.match(/^\/api\/sessions\/([^/]+)$/)
    // ── DELETE /api/sessions/:id —— 删除会话 ──
    // 功能说明: 删除指定 session，清理所有挂起的确认请求 + 关闭 query + 从 sessions Map 移除
    // 实现方式:
    //   1. ?deleteFiles=1 时删除对应的 .jsonl 文件（清理持久化对话记录）
    //   2. settlePending 所有挂起的确认请求（拒绝 + 标记为 'deleted'）
    //   3. pushStream.close() + query.return() 关闭 SDK query
    //   4. 从 sessions Map 删除 + 如为 focusedSessionId 则置空
    // 关键数据流: DELETE /api/sessions/:id → settlePending(all) → close query → delete session → 200 {ok:true}
    if (req.method === 'DELETE' && delM) {
        const delParam = delM[1];
        let id = delParam
        let s = sessions.get(id)
        // 侧栏删除传的是 .jsonl 文件名 (=SDK conversation ID)，sessions Map key 是 gatewayUUID，
        // 需要反查找到真正的 gateway UUID 才能正确关闭 query/pushStream/clients
        if (!s) {
            for (const [key, sess] of sessions) {
                if (sess.lastSessionId === delParam) { id = key; s = sess; break }
            }
        }
        // 先停 query（SDK 可能持有 .jsonl 文件句柄，Windows 下不先释放会导致 unlinkSync 失败）
        if (s) {
            for (const pid of [...(s.pending?.keys() || [])]) settlePending(id, pid, {
                behavior: 'deny',
                message: '会话已删除',
                interrupt: true
            }, 'deleted');
            await closeSessionRuntime(s, {sessionId: id, reason: 'delete_session'})
            s.eventJournal?.close()
            // 断开引用让 GC 回收，帮助 SDK 底层释放文件句柄
            s.query = null
            s.pushStream = null
            // 关闭所有 WS 客户端连接，触发桌面端 onclose 清理 UI 状态
            for (const ws of [...s.clients]) {
                try {
                    ws.close(4001, JSON.stringify({error: 'session deleted'}))
                } catch (error) {
                    log.debug({err: error, sessionId: id?.slice(0, 8)}, '关闭已删除 Session 的 WebSocket 失败')
                }
            }
        }
        // 先标记删除再清内存（_deletedSessionIds 已持久化，scanProjects 不会扫回）
        markSessionDeleted(delParam)
        if (s?.workDir) removeVisibleSession(s.workDir, id, s.lastSessionId || delParam)
        else removeVisibleSessionEverywhere(id, delParam)
        if (s) {
            finishImProgressReporters(id)
            sessions.delete(id)
            invalidateProjectsCache()
        }
        clearAdapterBindingsForSessions(delParam, id, s?.lastSessionId)
        if (focusedSessionId === id) focusedSessionId = null;
        res.writeHead(200);
        res.end(JSON.stringify({ok: true}));
        // 磁盘文件异步清理: SDK 进程退出滞后可能导致 deleteSessionFiles
        // 指数退避长达 10s+，不阻塞 HTTP 响应
        if (url.searchParams.get('deleteFiles') === '1') {
            deleteSessionFiles(delParam).catch(error => {
                log.warn({err: error, sessionId: delParam?.slice(0, 8)}, '后台清理 Session 文件失败')
            })
        }
        return
    }

    // ── Session 存在性检查（前端 switchToTab 恢复前校验）──
    // GET /api/sessions/:id/exists —— 返回 200 或 404，支持 SDK ID 反查
    const existsM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/exists$/)
    if (req.method === 'GET' && existsM) {
        const eid = existsM[1]
        let resolvedId = eid
        let s = sessions.get(eid)
        if (!s) {
            for (const [key, sess] of sessions) {
                if (sess.lastSessionId === eid) { resolvedId = key; s = sess; break }
            }
        }
        res.writeHead(s ? 200 : 404)
        const runtimeState = s ? getSessionRuntimeState(s) : null
        res.end(JSON.stringify(s ? {
            exists: true,
            sessionId: resolvedId,
            historySessionId: s.lastSessionId || null,
            workDir: s.workDir,
            taskState: taskStateForClient(s.taskState),
            ...runtimeState,
        } : {error: 'not found'}))
        return
    }

    // ── 批量删除会话 ──
    // POST /api/sessions/batch-delete  body: {ids: string[]}
    // 批量标记删除 + 后台异步清理文件，避免逐个 DELETE 串行阻塞
    if (req.method === 'POST' && url.pathname === '/api/sessions/batch-delete') {
        const body = await readBody(req)
        const ids = Array.isArray(body?.ids) ? body.ids : []
        const deleteFiles = body.deleteFiles !== false
        let deleted = 0
        for (const rawId of ids) {
            if (!rawId) continue
            let id = rawId
            let s = sessions.get(id)
            if (!s) {
                for (const [key, sess] of sessions) {
                    if (sess.lastSessionId === rawId) { id = key; s = sess; break }
                }
            }
            if (s) {
                for (const pid of [...(s.pending?.keys() || [])]) settlePending(id, pid, {
                    behavior: 'deny', message: '会话已删除', interrupt: true
                }, 'deleted')
                await closeSessionRuntime(s, {sessionId: id, reason: 'batch_delete_session'})
                s.query = null; s.pushStream = null
                s.eventJournal?.close()
                for (const ws of [...s.clients]) {
                    try {
                        ws.close(4001, JSON.stringify({error: 'session deleted'}))
                    } catch (error) {
                        log.debug({err: error, sessionId: id?.slice(0, 8)}, '关闭批量删除 Session 的 WebSocket 失败')
                    }
                }
                finishImProgressReporters(id)
                sessions.delete(id)
                removeVisibleSession(s.workDir, id, s.lastSessionId || rawId)
                clearAdapterBindingsForSessions(rawId, id, s.lastSessionId)
                if (focusedSessionId === id) focusedSessionId = null
                cleanupSessionUploads(s.workDir, id, deleteFiles)
            }
            markSessionDeleted(rawId)
            if (!s) removeVisibleSessionEverywhere(rawId, rawId)
            if (!s) clearAdapterBindingsForSessions(rawId)
            if (deleteFiles) deleteSessionFiles(rawId).catch(error => {
                log.warn({err: error, sessionId: rawId?.slice(0, 8)}, '后台批量清理 Session 文件失败')
            })
            deleted++
        }
        invalidateProjectsCache()
        res.writeHead(200)
        res.end(JSON.stringify({ok: true, deleted}))
        return
    }

    // ── 文件快照 Diff endpoints ──
    // GET /api/sessions/:id/files —— 文件树 + 改动状态
    const filesM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/files$/)
    if (req.method === 'GET' && filesM) {
        res.setHeader('Cache-Control', 'no-store')
        const s = sessions.get(filesM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        const scan = currentFileScan(s.workDir, s.snapshot)
        if (scan.missing) {
            res.writeHead(200);
            res.end(JSON.stringify({
                workDir: s.workDir,
                hasSnapshot: !!s.snapshot,
                gitInfo: s.snapshot?.gitHead || null,
                missing: true,
                files: [],
                truncated: false
            }));
            return
        }
        let files
        if (s.snapshot) {
            const diffMap = diffSnapshotVsCurrent(s.snapshot, scan.files, s.workDir)
            files = [...diffMap.entries()].map(([path, d]) => {
                const cur = scan.files.find(f => f.path === path)
                return {
                    path,
                    size: cur?.size ?? 0,
                    binary: d.binary,
                    status: d.status,
                    added: d.added,
                    removed: d.removed
                }
            })
        } else {
            files = scan.files.map(f => ({
                path: f.path,
                size: f.size,
                binary: f.binary,
                status: 'unchanged',
                added: 0,
                removed: 0
            }))
        }
        const projectCache = loadProjectCache(s.workDir)
        res.writeHead(200);
        res.end(JSON.stringify({
            workDir: s.workDir,
            hasSnapshot: !!s.snapshot,
            snapshotAt: s.snapshot?.takenAt || null,
            gitInfo: s.snapshot?.gitHead || null,
            truncated: scan.truncated,
            projectCacheWarnings: projectCache?.parserWarnings || [],
            files
        }))
        return
    }
    // ── POST /api/sessions/:id/upload —— 文件上传 + 多模态路由 ──
    // 功能说明: 接收前端上传的图片/文件，保存到临时目录并根据当前模型能力做路由处理
    //   支持多模态的模型 → 返回路径供 SDK 直接传 image content block
    //   不支持多模态 → 使用 Tesseract.js OCR 提取文字
    const uploadM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/upload$/)
    if (req.method === 'POST' && uploadM) {
        const sid = uploadM[1]
        const s = sessions.get(sid)
        if (!s) { res.writeHead(404); res.end(JSON.stringify({error: 'session not found'})); return }
        try {
            const { fields, files } = await parseMultipart(req)
            const file = files?.file
            if (!file) { res.writeHead(400); res.end(JSON.stringify({error: 'no file'})); return }

            const uploadDir = getUploadDir(s.workDir, sid)
            if (!uploadDir) { res.writeHead(400); res.end(JSON.stringify({error: 'invalid upload directory'})); return }
            prepareUploadDir(uploadDir, {
                ttlMs: UPLOAD_TTL_MS,
                onError: (error, path) => log.debug({err: error, path}, '读取附件元数据失败'),
            })
            const uploadTotal = readdirSync(uploadDir).reduce((sum, name) => {
                try {
                    const p = safeChildPath(uploadDir, name, {allowNested: false})
                    const st = p ? lstatSync(p) : null
                    return sum + (st?.isFile() ? st.size : 0)
                } catch { return sum }
            }, 0)
            if (uploadTotal + file.data.length > UPLOAD_QUOTA_BYTES) {
                res.writeHead(413); res.end(JSON.stringify({error: 'session upload quota exceeded'})); return
            }
            // 消毒文件名并保留真实文件类型；未知类型使用 .bin，绝不能伪装成图片。
            const attachment = describeAttachment(file.filename, file.contentType)
            const rawName = attachment.originalName
            const ext = attachment.extension
            const destName = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
            const destPath = safeChildPath(uploadDir, destName, {allowNested: false})
            if (!destPath) { res.writeHead(400); res.end(JSON.stringify({error: 'invalid upload path'})); return }
            writeFileSync(destPath, file.data)

            // 检查当前模型是否支持多模态
            const modelName = s.queryOpts?.model || ''
            const isMultimodal = /claude|gpt-4o|gpt-5|gemini|haiku|sonnet|opus/i.test(modelName)
            const isImage = isImageAttachment(attachment)

            if (isMultimodal && isImage) {
                // 只有真实图片才能走多模态标记；Word/PDF 等文档始终按文件路径处理。
                const relPath = relative(s.workDir, destPath)
                res.writeHead(200)
                res.end(JSON.stringify({ok: true, path: relPath, name: rawName, extension: ext, kind: attachment.kind, contentType: attachment.contentType, multimodal: true}))
            } else if (!isImage) {
                const relPath = relative(s.workDir, destPath)
                res.writeHead(200)
                res.end(JSON.stringify({ok: true, path: relPath, name: rawName, extension: ext, kind: attachment.kind, contentType: attachment.contentType, multimodal: false, ocrSkipped: true}))
            } else {
                // 非多模态模型 → 尝试 OCR 提取文字
                if (activeOcr >= MAX_OCR_CONCURRENT) {
                    const relPath = relative(s.workDir, destPath)
                    res.writeHead(200)
                    res.end(JSON.stringify({ok: true, path: relPath, name: rawName, extension: ext, kind: attachment.kind, contentType: attachment.contentType, multimodal: false, ocrSkipped: true}))
                    return
                }
                activeOcr++
                let ocrText = ''
                let worker = null
                try {
                    const { createWorker } = await import('tesseract.js')
                    worker = await createWorker('chi_sim+eng')
                    const { data } = await worker.recognize(destPath)
                    ocrText = data.text || ''
                } catch (ocrErr) {
                    log.warn({err: ocrErr, sessionId: sid?.slice(0, 8)}, 'OCR 失败，回退到文件路径引用')
                } finally {
                    try {
                        await worker?.terminate?.()
                    } catch (error) {
                        log.debug({err: error, sessionId: sid?.slice(0, 8)}, '终止 OCR worker 失败')
                    }
                    activeOcr--
                }
                if (ocrText.trim()) {
                    res.writeHead(200)
                    res.end(JSON.stringify({
                        ok: true, path: relative(s.workDir, destPath), name: rawName, extension: ext, kind: attachment.kind, contentType: attachment.contentType, multimodal: false,
                        ocrText: ocrText.trim()
                    }))
                } else {
                    const relPath = relative(s.workDir, destPath)
                    res.writeHead(200)
                    res.end(JSON.stringify({ok: true, path: relPath, name: rawName, extension: ext, kind: attachment.kind, contentType: attachment.contentType, multimodal: false}))
                }
            }
        } catch (e) {
            log.error({err: e, sessionId: sid?.slice(0, 8)}, '上传处理失败')
            res.writeHead(500); res.end(JSON.stringify({error: String(e?.message || e)}))
        }
        return
    }
    // GET /api/sessions/:id/file?path=xxx —— 当前文件内容
    const fileM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/file$/)
    if (req.method === 'GET' && fileM) {
        res.setHeader('Cache-Control', 'no-store')
        const s = sessions.get(fileM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        const rel = url.searchParams.get('path') || ''
        const abs = resolveSafe(s.workDir, rel)
        if (!abs || !existsSync(abs)) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'not_found'}));
            return
        }
        if (isBinaryPath(rel)) {
            let size = 0;
            try {
                size = statSync(abs).size
            } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
            ;res.writeHead(200);
            res.end(JSON.stringify({path: rel, binary: true, size}));
            return
        }
        let size = 0;
        try {
            size = statSync(abs).size
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        if (size > MAX_SNAP_FILE_BYTES) {
            res.writeHead(413);
            res.end(JSON.stringify({error: 'too_large', size}));
            return
        }
        try {
            const content = readFileSync(abs, 'utf8');
            res.writeHead(200);
            res.end(JSON.stringify({
                path: rel,
                binary: false,
                content,
                size,
                lines: content.length ? content.split('\n').length : 0
            }))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: String(e?.message || e)}))
        }
        return
    }
    // GET /api/sessions/:id/diff?path=xxx —— 文件变更 diff
    // old 优先用最新记录点的 before（和上版本对比），无记录点则用基线快照
    const diffM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/diff$/)
    if (req.method === 'GET' && diffM) {
        const s = sessions.get(diffM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        const rel = url.searchParams.get('path') || ''
        const abs = resolveSafe(s.workDir, rel)
        if (!abs) {
            res.writeHead(400);
            res.end(JSON.stringify({error: 'bad_path'}));
            return
        }
        if (isBinaryPath(rel)) {
            res.writeHead(200);
            res.end(JSON.stringify({path: rel, binary: true}));
            return
        }
        const snap = s.snapshot?.files?.get(rel)
        if (snap && (snap.tooLarge || snap.binary)) {
            res.writeHead(200);
            res.end(JSON.stringify({path: rel, tooLarge: !!snap.tooLarge, binary: !!snap.binary}));
            return
        }
        const curExists = existsSync(abs)
        // old=快照内容（基线），new=当前磁盘
        const oldStr = snap?.content ?? ''
        let newStr = ''
        if (curExists) {
            try {
                newStr = readFileSync(abs, 'utf8')
            } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        }
        const status = !snap ? 'added' : (!curExists ? 'deleted' : (oldStr === newStr ? 'unchanged' : 'modified'))
        const result = computeLineDiff(oldStr, newStr)
        if (result.tooLarge) {
            res.writeHead(200);
            res.end(JSON.stringify({path: rel, status, tooLarge: true}));
            return
        }
        const st = lineDiffStats(oldStr, newStr)
        res.writeHead(200);
        res.end(JSON.stringify({path: rel, status, added: st.added, removed: st.removed, lines: result.lines}))
        return
    }
    // POST /api/sessions/:id/snapshot —— 重置基线
    const snapM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/snapshot$/)
    if (req.method === 'POST' && snapM) {
        const s = sessions.get(snapM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        try {
            s.snapshot = buildFileSnapshot(s.workDir)  // SIDE_EFFECT: mutates session.snapshot
            if (!saveSnapshot(s, snapM[1])) throw new Error('snapshot 持久化失败')
            res.writeHead(200);
            res.end(JSON.stringify({ok: true, snapshotAt: s.snapshot.takenAt, fileCount: s.snapshot.files.size}))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: String(e?.message || e)}))
        }
        return
    }
    // POST /api/sessions/:id/save-and-snapshot { path, content } —— Monaco 保存后写文件并记录改动
    const saveSnapM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/save-and-snapshot$/)
    if (req.method === 'POST' && saveSnapM) {
        const s = sessions.get(saveSnapM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        try {
            const b = await readBody(req)
            if (!b.path || typeof b.content !== 'string') {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'path and content required'}));
                return
            }
            const abs = resolveSafe(s.workDir, b.path)
            if (!abs) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'bad_path'}));
                return
            }
            if (isBinaryPath(b.path)) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'binary_file'}));
                return
            }
            // 1. 文件写前内容：优先读磁盘（本次修改前状态），磁盘无则取快照
            let beforeContent = null
            try {
                beforeContent = readFileSync(abs, 'utf8')
            } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
            if (beforeContent === null) {
                const snapEntry = s.snapshot?.files?.get(b.path)
                if (snapEntry && !snapEntry.binary && !snapEntry.tooLarge && !snapEntry.readError && typeof snapEntry.content === 'string') {
                    beforeContent = snapEntry.content
                }
            }
            // 2. 写文件
            if (!existsSync(dirname(abs))) mkdirSync(dirname(abs), {recursive: true})
            writeFileSync(abs, b.content, 'utf8')
            // 3. 计算行级 diff 统计
            const diffStats = lineDiffStats(beforeContent || '', b.content)
            // 4. 创建记录点（和 AI 改完文件的体验一致）
            if (!s.checkpoints) s.checkpoints = []
            s.checkpointSeq = (s.checkpointSeq || 0) + 1
            const fileStatus = beforeContent === null ? 'added' : 'modified'
            s.checkpoints.push({
                id: `cp-${s.checkpointSeq}`,
                prompt: '手动保存 ' + b.path,
                time: Date.now(),
                files: [{
                    path: b.path,
                    status: fileStatus,
                    before: beforeContent,
                    notRevertible: beforeContent === null,
                    added: diffStats.added,
                    removed: diffStats.removed,
                }],
                revertible: beforeContent !== null,  // 新增文件不可回退
            })
            if (!saveCheckpoints(s, saveSnapM[1])) throw new Error('checkpoint 持久化失败')
            // 快照条目更新为保存前内容（beforeContent），持久化。
            // 文件面板 diffSnapshotVsCurrent(snapshot, 磁盘) → beforeContent ≠ 磁盘 → diff 按钮始终可见。
            // diff 端点 oldStr=snapshot.content, newStr=磁盘 → "上一版 vs 当前"。
            // 重启后 loadSnapshot 读到 beforeContent，仍然 ≠ 磁盘 → diff 按钮不消失。
            if (!s.snapshot) s.snapshot = { takenAt: Date.now(), files: new Map(), truncated: false }
            if (beforeContent !== null) {
              s.snapshot.files.set(b.path, { binary: false, content: beforeContent, size: Buffer.byteLength(beforeContent, 'utf8'), lines: beforeContent.length ? beforeContent.split('\n').length : 0 })
            }
            s.snapshot.takenAt = Date.now()
            if (!saveSnapshot(s, saveSnapM[1])) throw new Error('snapshot 持久化失败')
            res.writeHead(200);
            res.end(JSON.stringify({
                ok: true,
                snapshotAt: s.snapshot.takenAt,
                fileCount: s.snapshot.files.size,
            }))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: String(e?.message || e)}))
        }
        return
    }
    // POST /api/mirror —— IM 命令专用：一次调用完成镜像查询/设置/翻转
    // body: { platform, action?: 'query'|'set'|'toggle', enabled? }
    if (req.method === 'POST' && url.pathname === '/api/mirror') {
        const b = await readBody(req)
        const identity = getAdapterIdentity(req)
        const binding = identity ? readAdapterBindings()[`${identity.source}:${identity.userId}`] : null
        if (!identity || !binding) {
            res.writeHead(403); res.end(JSON.stringify({error: 'session ownership mismatch'})); return
        }
        if (focusedSessionId && !adapterOwnsFocusedSession(identity)) {
            res.writeHead(403); res.end(JSON.stringify({error: 'session ownership mismatch'})); return
        }
        const platform = b.platform
        // 查询所有镜像状态
        if (!platform) {
            if (!focusedSessionId || !sessions.has(focusedSessionId)) {
                res.writeHead(200); res.end(JSON.stringify({ok: true, mirrors: {wechat: false, feishu: false, dingtalk: false}, hasSession: false})); return
            }
            const s = sessions.get(focusedSessionId)
            res.writeHead(200); res.end(JSON.stringify({ok: true, mirrors: s.mirrors || {wechat: false, feishu: false, dingtalk: false}, hasSession: true})); return
        }
        if (!['wechat', 'feishu', 'dingtalk'].includes(platform)) { res.writeHead(400); res.end(JSON.stringify({error: 'bad platform'})); return }
        if (platform !== identity.source) {
            res.writeHead(403); res.end(JSON.stringify({error: 'cross-platform mirror control is not allowed'})); return
        }
        if (!focusedSessionId || !sessions.has(focusedSessionId)) {
            res.writeHead(200); res.end(JSON.stringify({ok: true, error: 'no_session', hasSession: false})); return
        }
        const s = sessions.get(focusedSessionId)
        s.mirrors = s.mirrors || {wechat: false, feishu: false, dingtalk: false}
        let enabled
        if (b.action === 'set') {
            enabled = !!b.enabled
        } else {
            // toggle → 翻转
            enabled = !s.mirrors[platform]
        }
        const previousMirrors = {...s.mirrors}
        s.mirrors[platform] = enabled   // SIDE_EFFECT: mutates session.mirrors
        if (!persistSessionMirrors(s, focusedSessionId, platform, enabled)) {
            s.mirrors = previousMirrors
            res.writeHead(500); res.end(JSON.stringify({error: 'session mirror state persistence failed'})); return
        }
        // nudge 桌面端同步按钮状态
        const nudge = {type: 'nudge', action: 'toggle_mirror', args: {platform, enabled}, nudgeId: crypto.randomUUID(), source: 'adapter'}
        for (const ws of controlClients) {
            if (ws.readyState === 1) ws.send(JSON.stringify(nudge))
        }
        for (const [, ss] of sessions) {
            for (const ws of ss.clients) {
                if (ws._source === 'desktop' && ws.readyState === 1) ws.send(JSON.stringify(nudge))
            }
        }
        res.writeHead(200); res.end(JSON.stringify({ok: true, platform, enabled})); return
    }

    // POST /api/sessions/:id/mirror { platform, enabled } —— 切换 IM 平台镜像同步开关
    // GET  /api/sessions/:id/mirror —— 查当前各平台镜像开关状态
    const mirrorM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/mirror$/)
    if (mirrorM) {
        const s = sessions.get(mirrorM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        const identity = getAdapterIdentity(req)
        if (identity && !adapterOwnsSession(identity.source, identity.userId, mirrorM[1])) {
            res.writeHead(403)
            res.end(JSON.stringify({error: 'session ownership mismatch'}))
            return
        }
        if (req.method === 'GET') {
            res.writeHead(200);
            res.end(JSON.stringify({mirrors: s.mirrors || {wechat: false, feishu: false, dingtalk: false}}));
            return
        }
        if (req.method === 'POST') {
            const b = await readBody(req)
            if (!ADAPTER_PLATFORMS.includes(b.platform)) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'valid platform required'}));
                return
            }
            s.mirrors = s.mirrors || {wechat: false, feishu: false, dingtalk: false}
            const previousMirrors = {...s.mirrors}
            const enabled = b.enabled === true
            s.mirrors[b.platform] = enabled   // SIDE_EFFECT: mutates session.mirrors
            if (!persistSessionMirrors(s, mirrorM[1], b.platform, enabled)) {
                s.mirrors = previousMirrors
                res.writeHead(500)
                res.end(JSON.stringify({error: 'session mirror state persistence failed'}))
                return
            }
            res.writeHead(200);
            res.end(JSON.stringify({ok: true, platform: b.platform, enabled: s.mirrors[b.platform]}));
            return
        }
    }
    // POST /api/sessions/:id/commit —— 提交修改：以当前状态为新基线 + 清空所有记录点
    // 可选 body: { files?: string[] } —— 指定文件列表则仅提交这些文件，未指定的保持旧基线
    const commitM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/commit$/)
    if (req.method === 'POST' && commitM) {
        const s = sessions.get(commitM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        try {
            const body = await readBody(req).catch(() => ({}))
            const selectedFiles = Array.isArray(body.files) && body.files.length > 0 ? new Set(body.files) : null

            if (selectedFiles && s.snapshot) {
                // 选择性提交：用 buildFileSnapshot 生成当前全量快照，保证内容与 diff 对比一致
                const fresh = buildFileSnapshot(s.workDir)
                const oldFiles = s.snapshot.files
                const merged = new Map()

                // 遍历旧基线：已提交文件 → 用 fresh 内容（匹配当前磁盘，diff 归零）；
                // 未提交文件 → 保留旧基线内容（diff 继续显示变更）
                for (const [path, oldEntry] of oldFiles) {
                    if (selectedFiles.has(path)) {
                        const newEntry = fresh.files.get(path)
                        if (newEntry) merged.set(path, newEntry)
                        // 文件已删除且被提交：不加入新基线，后续 diff 视为新增
                    } else {
                        merged.set(path, oldEntry)
                    }
                }
                // 追加旧基线中没有的新文件（selected 的才纳入基线，未选中的保持 added 状态）
                for (const [path, newEntry] of fresh.files) {
                    if (!merged.has(path) && selectedFiles.has(path)) {
                        merged.set(path, newEntry)
                    }
                }
                s.snapshot = {takenAt: Date.now(), truncated: fresh.truncated, files: merged}
            } else {
                // 全量提交：重建整个基线
                s.snapshot = buildFileSnapshot(s.workDir)   // SIDE_EFFECT: 新基线=当前
            }

            // ── Git 提交消息收集：在清空记录点前提取 prompt 和文件列表 ──
            const originalCps = s.checkpoints ? [...s.checkpoints] : []
            const committedCps = selectedFiles
                ? originalCps.filter(cp => cp.files.some(f => selectedFiles.has(f.path)))
                : originalCps

            // 记录点处理：选择性提交时只移除已提交文件，保留仍有未提交文件的记录点
            if (selectedFiles) {
                const cps = s.checkpoints || []
                if (cps.length) {
                    const kept = []
                    for (const cp of cps) {
                        const remaining = cp.files.filter(f => !selectedFiles.has(f.path))
                        if (remaining.length === 0) continue  // 该记录点所有文件都已提交，移除
                        const stillRevertible = remaining.every(f => !f.notRevertible)
                        kept.push({...cp, files: remaining, revertible: stillRevertible})
                    }
                    s.checkpoints = kept
                }
            } else {
                s.checkpoints = []  // 全量提交：清空所有记录点
            }

            if (!saveSnapshot(s, commitM[1])) throw new Error('snapshot 持久化失败')
            if (!saveCheckpoints(s, commitM[1])) throw new Error('checkpoint 持久化失败')

            // ── Git 自动提交 ──
            let gitCommit = null
            let gitCommitError = null
            try {
                const gitDir = execSync('git rev-parse --git-dir', {
                    cwd: s.workDir, encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe']
                }).trim()
                if (gitDir) {
                    // 收集提交信息：记录点 prompt 作标题 + 变更文件清单
                    const prompts = [...new Set(committedCps
                        .map(cp => typeof cp.prompt === 'string' ? cp.prompt.replace(/\0/g, '').trim() : '')
                        .filter(Boolean))]
                    const subject = (prompts[0] || 'checkpoint commit').split(/\r?\n/, 1)[0].slice(0, 200)

                    const fileSet = new Map()
                    for (const cp of committedCps) {
                        for (const f of cp.files) {
                            if (selectedFiles && !selectedFiles.has(f.path)) continue
                            if (!fileSet.has(f.path)) fileSet.set(f.path, f.status)
                        }
                    }
                    const fileLines = [...fileSet.entries()]
                        .map(([p, st]) => {
                            const prefix = st === 'added' ? 'A' : st === 'deleted' ? 'D' : 'M'
                            return `${prefix} ${String(p).replace(/[\r\n\0]/g, '_')}`
                        })
                        .join('\n')

                    const bodyParts = [subject]
                    if (prompts.length > 1) bodyParts.push('', ...prompts.slice(1, 20).map(p => `- ${p.slice(0, 1000)}`))
                    if (fileLines) bodyParts.push('', fileLines)

                    execFileSync('git', ['add', '-A'], {
                        cwd: s.workDir, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe']
                    })
                    // 从 stdin 传提交信息，既禁止 shell 解析，也不受 Windows 命令行长度限制。
                    const commitMessage = bodyParts.join('\n').slice(0, 1024 * 1024)
                    execFileSync('git', ['commit', '-F', '-', '--allow-empty-message'], {
                        cwd: s.workDir, encoding: 'utf8', timeout: 10000,
                        stdio: ['pipe', 'pipe', 'pipe'], input: commitMessage,
                    })
                    const hash = execSync('git rev-parse --short HEAD', {
                        cwd: s.workDir, encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe']
                    }).trim()
                    gitCommit = {hash, subject}
                    log.info({sessionId: commitM[1]?.slice(0, 8), hash, subject}, 'Git 自动提交')
                }
            } catch (error) {
                gitCommitError = String(error?.stderr || error?.message || error).trim().slice(0, 500)
                log.warn({err: error, sessionId: commitM[1]?.slice(0, 8)}, '记录点已提交，但 Git 自动提交失败')
            }

            res.writeHead(200);
            res.end(JSON.stringify({
                ok: true,
                snapshotAt: s.snapshot.takenAt,
                fileCount: selectedFiles ? selectedFiles.size : s.snapshot.files.size,
                keptCheckpoints: selectedFiles ? (s.checkpoints || []).length : 0,
                gitCommit,
                gitCommitError,
            }))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: String(e?.message || e)}))
        }
        return
    }

    // GET /api/sessions/:id/checkpoints —— 记录点列表（剥离 before 大文本，只回元信息）
    const cpM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/checkpoints$/)
    if (req.method === 'GET' && cpM) {
        const s = sessions.get(cpM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        const list = (s.checkpoints || []).map(c => ({
            id: c.id, prompt: c.prompt, time: c.time, revertible: c.revertible,
            fileCount: c.files.length,
            added: c.files.reduce((n, f) => n + (f.added || 0), 0),
            removed: c.files.reduce((n, f) => n + (f.removed || 0), 0),
            files: c.files.map(f => ({
                path: f.path,
                status: f.status,
                notRevertible: !!f.notRevertible,
                added: f.added,
                removed: f.removed
            })),
        }))
        res.writeHead(200);
        res.end(JSON.stringify({checkpoints: list}));
        return
    }
    // POST /api/sessions/:id/rewind { checkpointId, dryRun? } —— 回退到记录点之前
    const rwM = url.pathname.match(/^\/api\/sessions\/([^/]+)\/rewind$/)
    if (req.method === 'POST' && rwM) {
        const s = sessions.get(rwM[1])
        if (!s) {
            res.writeHead(404);
            res.end(JSON.stringify({error: 'session not found'}));
            return
        }
        const b = await readBody(req)
        if (!b.checkpointId) {
            res.writeHead(400);
            res.end(JSON.stringify({error: 'checkpointId required'}));
            return
        }
        const r = rewindToCheckpoint(rwM[1], b.checkpointId, !!b.dryRun)  // SIDE_EFFECT: 写工作目录文件
        // 撤回后增量更新缓存（仅重提取被还原的文件）
        if (!b.dryRun && r.ok && r.reverted?.length) {
            try {
                const cache = loadProjectCache(s.workDir)
                if (cache) {
                    // 构造简易 diffMap：所有被还原文件标为 modified 强制重提取
                    const diffMap = new Map()
                    for (const path of r.reverted) {
                        diffMap.set(path, {status: 'modified', binary: false})
                    }
                    await updateProjectCache(s.workDir, cache, diffMap)
                    saveProjectCache(s.workDir, cache)
                } else {
                    const newCache = await buildProjectCache(s.workDir)
                    if (newCache) saveProjectCache(s.workDir, newCache)
                }
            } catch (e) {
                log.warn({err: e, sessionId: rwM[1]?.slice(0, 8)}, 'rewind 后缓存更新失败')
            }
        }
        res.writeHead(r.ok ? 200 : r.code === 'persist_failed' ? 500 : 404);
        res.end(JSON.stringify(r));
        return
    }

    // ── Config endpoints ──

    // ── /api/config/settings —— Bridge 通用配置 + 私有 provider 配置 ──
    // provider 字段只写 bridge-provider.json；settings.json 不保留第二份模型、地址或密钥。
    if (url.pathname === '/api/config/settings') {
        const sp = join(BRIDGE_HOME, 'settings.json');
        if (req.method === 'GET') {
            const d = readJSON(sp) || {};
            const effective = overlayBridgeProviderSettings(d, loadBridgeProviderSettings())
            res.writeHead(200);
            res.end(JSON.stringify({...effective, env: redactSecretMap(effective.env)}))
            ;
            return
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req);
                if (b._parseError || b._bodyTooLarge) {
                    res.writeHead(b._bodyTooLarge ? 413 : 400);
                    res.end(JSON.stringify({error: b._bodyTooLarge ? 'payload too large' : 'invalid JSON'}));
                    return
                }
                const current = readJSON(sp) || {}
                const currentBridgeProvider = loadBridgeProviderSettings()
                const currentEffective = overlayBridgeProviderSettings(current, currentBridgeProvider)
                if (b.env) {
                    // 脱敏占位符必须从 Bridge 私有配置恢复，不能从 CCSwitch 的 settings 恢复。
                    b.env = restoreSecretMap(b.env, currentEffective.env || {})
                    b.env.ANTHROPIC_MODEL = b.model || ''
                    saveBridgeProviderSettings(extractBridgeProviderSettings(b, currentBridgeProvider))
                    // 清理 env 段中与当前供应商不匹配的残留字段，防止 claude.exe 读到旧模型名发给第三方 API 导致 403
                    // 移除 ANTHROPIC_DEFAULT_* 和 cc-switch 非标准后缀字段
                    // makeQueryOptions 运行时会根据当前模型动态设置这些值
                    delete b.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME
                    delete b.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME
                    delete b.env.ANTHROPIC_DEFAULT_OPUS_MODEL
                    delete b.env.ANTHROPIC_DEFAULT_SONNET_MODEL
                    delete b.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
                }
                const persisted = stripBridgeProviderSettings(b)
                backupFile(sp);
                writeJSON(sp, persisted);
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return
        }
    }
    // ── Claude Code 安装状态查询（前端弹窗用）──
    // ── GET /api/version —— 返回 Gateway 版本号 ──
    if (req.method === 'GET' && url.pathname === '/api/version') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({version: PKG_VERSION}));
        return
    }
    // ── GET /api/health —— Gateway 与持久化状态健康信息 ──
    if (req.method === 'GET' && url.pathname === '/api/health') {
        const healthy = !bridgeStateDb?.degraded
        res.writeHead(healthy ? 200 : 503, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({
            ok: healthy,
            version: PKG_VERSION,
            stateStoreMode: bridgeStateDb?.mode || 'unavailable',
            stateStoreSchemaVersion: bridgeStateDb?.schemaVersion || 0,
            stateStoreDegraded: Boolean(bridgeStateDb?.degraded),
            stateStoreDegradedReason: bridgeStateDb?.degradedReason || null,
            stateStoreQuarantined: bridgeStateDb?.quarantinePaths?.length || 0,
        }))
        return
    }
    // ── GET /api/config/claude-status —— Claude Code 安装状态查询 ──
    // 功能说明: 前端弹窗用，检测本地是否安装了 Claude Code 可执行文件
    // 实现方式: 支持 ?path= 查询参数手动指定路径；无参数时调用 getClaudeExe() 多级回退查找
    // 关键数据流: GET → getClaudeExe() 或存在性检查 → 200 {found:bool, path:...}
    if (req.method === 'GET' && url.pathname === '/api/config/claude-status') {
        const qPath = url.searchParams.get('path')
        let foundPath = null
        if (qPath) {
            foundPath = existsSync(qPath) ? qPath : null
        } else {
            foundPath = getClaudeExe()
        }
        res.writeHead(200);
        res.end(JSON.stringify({found: !!foundPath, path: foundPath || null}));
        return
    }
    // ── POST /api/config/claude-path —— 手动设置 Claude Code 路径 ──
    // 功能说明: 前端弹窗中用户手动输入路径，校验后保存到 settings.json
    // 实现方式: 校验路径文件是否存在 → 写入 cliS.claudeExe → 保存 settings.json → 返回结果
    // 关键数据流: POST {path} → existsSync → writeJSON settings.json → 200 {found, path}
    if (req.method === 'POST' && url.pathname === '/api/config/claude-path') {
        try {
            const b = await readBody(req)
            const p = (b.path || '').trim()
            if (!p) {
                res.writeHead(400);
                res.end(JSON.stringify({ok: false, error: 'path required'}));
                return
            }
            if (!existsSync(p)) {
                res.writeHead(200);
                res.end(JSON.stringify({ok: false, found: false, path: p, error: '文件不存在'}));
                return
            }
            const cliS = loadCliSettingsForUpdate()
            cliS.claudeExe = p
            backupFile(join(BRIDGE_HOME, 'settings.json'))
            writeJSON(join(BRIDGE_HOME, 'settings.json'), cliS)
            _exe = p // 更新缓存
            log.info({path: p}, '用户手动设置 claudeExe')
            res.writeHead(200);
            res.end(JSON.stringify({ok: true, found: true, path: p}));
            return
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ok: false, error: e.message}));
            return
        }
    }
    // ── GET /api/config/skills —— 列出所有 Skills ──
    // 功能说明: 扫描 ~/.claude-desktop-bridge/skills/ 目录下所有 SKILL.md，解析 frontmatter 返回名称/描述/内容
    // 实现方式: readdirSync → forEach 读 SKILL.md → parseFrontmatter 提取元数据
    // 关键数据流: skills/ 目录 → 遍历读 SKILL.md → 200 {skills: [{name, description, content, size}]}
    if (req.method === 'GET' && url.pathname === '/api/config/skills') {
        const sd = join(BRIDGE_HOME, 'skills');
        const r = [];
        const builtinNames = new Set(builtinCache.skills);
        const seen = new Set();
        try {
            for (const n of readdirSync(sd)) {
                try {
                    const c = readFileSync(join(sd, n, 'SKILL.md'), 'utf8');
                    const {frontmatter: fm} = parseFrontmatter(c);
                    const name = fm.name || n;
                    seen.add(name);
                    r.push({
                        name,
                        description: fm.description || '',
                        allowedTools: fm['allowed-tools'] || '',
                        content: c,
                        size: c.length,
                        source: 'custom'
                    })
                } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
            }
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        ;
        for (const bn of builtinCache.skills) {
            if (!seen.has(bn)) r.push({
                name: bn,
                description: '',
                allowedTools: '',
                content: null,
                size: 0,
                source: 'builtin'
            })
        }
        ;res.writeHead(200);
        res.end(JSON.stringify({skills: r}));
        return
    }
    const skillM = url.pathname.match(/^\/api\/config\/skills\/(.+)$/);
    if (skillM) {
        const sn = safeDecodeURIComponent(skillM[1]);
        const skillsDir = join(BRIDGE_HOME, 'skills')
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(sn)) {
            res.writeHead(400)
            res.end(JSON.stringify({error: 'invalid skill name'}))
            return
        }
        const skillDir = safeBasename(skillsDir, sn)
        const sp = skillDir ? safeChildPath(skillDir, 'SKILL.md', {allowNested: false, extensions: ['.md']}) : null
        if (!sp) {
            res.writeHead(400)
            res.end(JSON.stringify({error: 'invalid skill path'}))
            return
        }
        if (req.method === 'GET') {
            try {
                const c = readFileSync(sp, 'utf8');
                const {frontmatter: fm} = parseFrontmatter(c);
                res.writeHead(200);
                res.end(JSON.stringify({name: fm.name || sn, description: fm.description || '', content: c}))
            } catch {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'not found'}))
            }
            ;
            return
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req);
                if (!existsSync(skillsDir)) mkdirSync(skillsDir, {recursive: true})
                if (!existsSync(skillDir)) mkdirSync(skillDir, {recursive: true})
                backupFile(sp);
                writeFileSync(sp, b.content, 'utf8');
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return
        }
        // ── DELETE /api/config/skills/:name —— 删除 Skill 目录 ──
        // 仅已禁用的 skill 可删除（防止误删正在使用的 skill）
        if (req.method === 'DELETE') {
            try {
                const s = readJSON(join(BRIDGE_HOME, 'settings.json')) || {}
                if (!(s.disabledSkills || []).includes(sn)) {
                    res.writeHead(409)
                    res.end(JSON.stringify({error: '请先禁用再删除'}))
                    return
                }
                if (existsSync(skillDir)) { backupFile(skillDir); rmdirSync(skillDir, {recursive: true}) }
                res.writeHead(200)
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500)
                res.end(JSON.stringify({error: e.message}))
            }
            return
        }
    }
    // ── POST /api/config/skills —— 创建新 Skill ──
    // 功能说明: 在 ~/.claude-desktop-bridge/skills/ 下创建新的 SKILL.md，名称自动 sanitize 为小写+连字符
    //   已存在则返回 409
    // 关键数据流: POST {name, content?} → mkdir + writeFile → 201 {ok:true, name}
    if (req.method === 'POST' && url.pathname === '/api/config/skills') {
        try {
            const b = await readBody(req);
            const n = (b.name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
            if (!n) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'name required'}));
                return
            }
            ;const d = join(BRIDGE_HOME, 'skills', n);
            if (existsSync(d)) {
                res.writeHead(409);
                res.end(JSON.stringify({error: 'exists'}));
                return
            }
            ;mkdirSync(d, {recursive: true});
            writeFileSync(join(d, 'SKILL.md'), b.content || `---\nname: ${n}\ndescription: \n---\n\n`, 'utf8');
            res.writeHead(201);
            res.end(JSON.stringify({ok: true, name: n}))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}))
        }
        ;
        return
    }
    // ── GET /api/config/disabled-skills —— 获取已禁用的 skill 名称列表 ──
    if (req.method === 'GET' && url.pathname === '/api/config/disabled-skills') {
        const s = readJSON(join(BRIDGE_HOME, 'settings.json')) || {}
        res.writeHead(200)
        res.end(JSON.stringify({disabled: s.disabledSkills || []}))
        return
    }
    // ── POST /api/config/disabled-skills —— 切换 skill 启用/禁用状态 ──
    if (req.method === 'POST' && url.pathname === '/api/config/disabled-skills') {
        try {
            const b = await readBody(req)
            const name = (b.name || '').trim()
            if (!name) { res.writeHead(400); res.end(JSON.stringify({error: 'name required'})); return }
            const s = loadCliSettingsForUpdate()
            if (!s.disabledSkills) s.disabledSkills = []
            if (b.disabled) {
                if (!s.disabledSkills.includes(name)) s.disabledSkills.push(name)
            } else {
                s.disabledSkills = s.disabledSkills.filter((n) => n !== name)
            }
            writeJSON(join(BRIDGE_HOME, 'settings.json'), s)
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, name, disabled: b.disabled}))
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({error: e.message})) }
        return
    }
    // ── GET /api/config/disabled-mcp-plugins —— 获取已禁用的 MCP 插件名称列表 ──
    if (req.method === 'GET' && url.pathname === '/api/config/disabled-mcp-plugins') {
        const s = readJSON(join(BRIDGE_HOME, 'settings.json')) || {}
        res.writeHead(200)
        res.end(JSON.stringify({disabled: s.disabledMcpPlugins || []}))
        return
    }
    // ── POST /api/config/disabled-mcp-plugins —— 切换 MCP 插件启用/禁用状态 ──
    if (req.method === 'POST' && url.pathname === '/api/config/disabled-mcp-plugins') {
        try {
            const b = await readBody(req)
            const name = (b.name || '').trim()
            if (!name) { res.writeHead(400); res.end(JSON.stringify({error: 'name required'})); return }
            const s = loadCliSettingsForUpdate()
            if (!s.disabledMcpPlugins) s.disabledMcpPlugins = []
            if (b.disabled) {
                if (!s.disabledMcpPlugins.includes(name)) s.disabledMcpPlugins.push(name)
            } else {
                s.disabledMcpPlugins = s.disabledMcpPlugins.filter((n) => n !== name)
            }
            writeJSON(join(BRIDGE_HOME, 'settings.json'), s)
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, name, disabled: b.disabled}))
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({error: e.message})) }
        return
    }
    // ── GitHub raw 下载（多镜像回退）──
    // raw.githubusercontent.com 国内常被墙，jsdelivr CDN 优先
    async function fetchRawGithub(owner, repo, ref, filePath) {
        const urls = [
            `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${filePath}`,
            `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`,
            `https://mirror.ghproxy.com/https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`,
        ]
        for (const u of urls) {
            try {
                const r = await fetch(u, {signal: AbortSignal.timeout(8000)})
                if (r.ok) { log.info({url: u}, 'fetchRawGithub 成功'); return r }
            } catch (error) {
                log.debug({err: error, url: u}, 'fetchRawGithub 镜像请求失败')
            }
        }
        log.warn({owner, repo, ref, filePath}, 'fetchRawGithub 所有镜像均失败')
        return null
    }

    // ── GET /api/config/skills-market?q=xxx —— 多源搜索 Skills ──
    // 来源: skills.sh + GitHub Code Search (SKILL.md)
    // 返回: {results: [{name, description, url, source, stars?}]}
    if (req.method === 'GET' && url.pathname === '/api/config/skills-market') {
        const q = url.searchParams.get('q') || ''
        if (!q.trim()) { res.writeHead(200); res.end(JSON.stringify({results: []})); return }
        const results = []

        // ── 源 1: skills.sh ──
        try {
            const apiUrl = `https://skills.sh/api/search?q=${encodeURIComponent(q.trim())}`
            const resp = await fetch(apiUrl, {signal: AbortSignal.timeout(10000)})
            if (resp.ok) {
                const data = await resp.json()
                for (const item of (data.results || data || []).slice(0, 10)) {
                    results.push({
                        name: item.name || item.id || '',
                        description: item.description || item.summary || '',
                        url: item.url || item.downloadUrl || item.rawUrl || '',
                        source: 'skills.sh',
                        stars: item.stars,
                    })
                }
            }
        } catch { /* skills.sh 不可达，继续其他源 */ }

        // ── 源 2: GitHub Code Search (SKILL.md 文件) ──
        try {
            const ghQuery = encodeURIComponent(`SKILL.md ${q.trim()} in:file language:markdown`)
            const ghUrl = `https://api.github.com/search/code?q=${ghQuery}&per_page=10`
            const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'claude-desktop-bridge' }
            const ghResp = await fetch(ghUrl, {headers, signal: AbortSignal.timeout(10000)})
            if (ghResp.ok) {
                const ghData = await ghResp.json()
                for (const item of (ghData.items || [])) {
                    const repoFull = item.repository?.full_name || ''
                    const path = item.path || ''
                    // 从 path 提取 skill 名称 (skills/<name>/SKILL.md 或 <name>/SKILL.md)
                    const parts = path.replace(/\/SKILL\.md$/i, '').split('/')
                    const skillName = parts[parts.length - 1]
                    const rawUrl = `https://raw.githubusercontent.com/${repoFull}/main/${path}`
                    const name = repoFull ? `${repoFull}/${skillName}` : skillName
                    if (results.find(r => r.url === rawUrl)) continue  // 去重
                    results.push({
                        name,
                        description: `GitHub: ${repoFull} — ${path}`,
                        url: rawUrl,
                        source: 'github',
                        stars: item.repository?.stargazers_count,
                    })
                }
            }
        } catch { /* GitHub 不可达 */ }

        // ── 源 3: npm registry (关键词 claude-code-skill) ──
        try {
            const npmUrl = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q.trim())}+keywords:claude-code-skill&size=10`
            const npmResp = await fetch(npmUrl, {signal: AbortSignal.timeout(10000)})
            if (npmResp.ok) {
                const npmData = await npmResp.json()
                for (const obj of (npmData.objects || [])) {
                    const pkg = obj.package || {}
                    const repoUrl = pkg.links?.repository || ''
                    const rawUrl = repoUrl
                        ? repoUrl.replace('github.com', 'raw.githubusercontent.com').replace(/\/tree\//, '/') + '/main/SKILL.md'
                        : ''
                    if (!rawUrl || results.find(r => r.url === rawUrl)) continue
                    results.push({
                        name: pkg.name,
                        description: pkg.description || '',
                        url: rawUrl,
                        source: 'npm',
                        version: pkg.version,
                    })
                }
            }
        } catch { /* npm 不可达 */ }

        res.writeHead(200)
        res.end(JSON.stringify({results: results.slice(0, 30)}))
        return
    }
    // ── POST /api/config/skills-market/install —— 从 URL 安装 skill ──
    // 支持: 原始 SKILL.md URL / GitHub 各种链接
    if (req.method === 'POST' && url.pathname === '/api/config/skills-market/install') {
        try {
            const b = await readBody(req)
            const rawUrl = (b.url || '').trim()
            const name = (b.name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
            if (!rawUrl || !name) { res.writeHead(400); res.end(JSON.stringify({error: 'url and name required'})); return }

            let resp = null

            // ── 情况 1: github.com/owner/repo (裸 repo URL) ──
            const bareRepo = rawUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
            if (bareRepo) {
                const [_, owner, repo] = bareRepo
                // 尝试多种可能的 SKILL.md 路径
                const candidates = [
                    `skills/${name}/SKILL.md`,
                    `SKILL.md`,
                    `${name}/SKILL.md`,
                ]
                for (const fp of candidates) {
                    resp = await fetchRawGithub(owner, repo, 'main', fp)
                    if (resp) break
                }
                if (!resp) {
                    res.writeHead(502)
                    res.end(JSON.stringify({error: `仓库 ${owner}/${repo} 中未找到 SKILL.md，尝试路径: ${candidates.join(', ')}`}))
                    return
                }
            }

            // ── 情况 2: github.com/owner/repo/blob/<ref>/<path> ──
            const blobUrl = rawUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/)
            if (!resp && blobUrl) {
                resp = await fetchRawGithub(blobUrl[1], blobUrl[2], blobUrl[3], blobUrl[4])
                if (!resp) {
                    res.writeHead(502)
                    res.end(JSON.stringify({error: `无法从 ${blobUrl[1]}/${blobUrl[2]} 下载 ${blobUrl[4]}`}))
                    return
                }
            }

            // ── 情况 3: raw.githubusercontent.com / cdn.jsdelivr.net 等直链 ──
            const rawGitHub = rawUrl.match(/^https:\/\/(?:raw\.githubusercontent\.com|cdn\.jsdelivr\.net\/gh|mirror\.ghproxy\.com\/https\/raw\.githubusercontent\.com)\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/)
            if (!resp && rawGitHub) {
                resp = await fetchRawGithub(rawGitHub[1], rawGitHub[2], rawGitHub[3], rawGitHub[4])
                if (!resp) {
                    res.writeHead(502)
                    res.end(JSON.stringify({error: `无法下载 ${rawGitHub[4]}，所有镜像均失败`}))
                    return
                }
            }

            // ── 情况 4: 其他直链 URL（仅允许已知代码托管平台，防止 SSRF）──
            if (!resp) {
                const allowedHosts = /^https:\/\/([^/]+\.)?(github\.com|githubusercontent\.com|gitlab\.com|bitbucket\.org|jsdelivr\.net|ghproxy\.com|gitee\.com)(\/|$)/i
                if (allowedHosts.test(rawUrl)) {
                    try {
                        resp = await fetch(rawUrl, {signal: AbortSignal.timeout(30000)})
                    } catch (error) {
                        log.debug({err: error, url: rawUrl}, 'Skill 直链下载失败')
                    }
                }
            }

            if (!resp || !resp.ok) { res.writeHead(502); res.end(JSON.stringify({error: `下载失败 ${resp?.status || '网络不可达'}`})); return }
            const content = (await readFetchBodyLimited(resp, MAX_REMOTE_TEXT_BYTES)).toString('utf8')
            if (!content.trim()) { res.writeHead(502); res.end(JSON.stringify({error: '下载内容为空'})); return }

            // ── 校验: 拒绝非 SKILL.md 内容（GitHub HTML 页面等）──
            if (!content.includes('---') && content.includes('<!DOCTYPE')) {
                res.writeHead(502)
                res.end(JSON.stringify({error: '下载内容非 SKILL.md（可能是 GitHub 页面），请提供原始文件直链'}))
                return
            }

            const d = join(BRIDGE_HOME, 'skills', name)
            mkdirSync(d, {recursive: true})
            writeFileSync(join(d, 'SKILL.md'), content, 'utf8')
            log.info({name}, 'skill 已从市场安装')
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, name}))
        } catch (e) {
            log.error({err: e}, 'skill 安装失败')
            res.writeHead(500)
            res.end(JSON.stringify({error: e.message || '安装失败'}))
        }
        return
    }
    // ── GET/PUT /api/config/caveman —— Caveman 压缩模式配置 ──
    // 功能说明: GET 读取 Caveman 配置 + 版本信息；PUT 全量写入
    if (url.pathname === '/api/config/caveman') {
        if (req.method === 'GET') {
            res.writeHead(200)
            res.end(JSON.stringify({
                ...loadCavemanConfig(),
                cavemanCurrent: dynamicCache.cavemanCurrent || null,
                cavemanUpdate: dynamicCache.cavemanUpdate || null,
                releases: dynamicCache.cavemanReleases || [],
            }))
            return
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req)
                const level = (b.level || 'full').trim()
                if (!CAVEMAN_VALID_LEVELS.includes(level)) {
                    res.writeHead(400)
                    res.end(JSON.stringify({error: `无效级别，支持: ${CAVEMAN_VALID_LEVELS.join(', ')}`}))
                    return
                }
                saveCavemanConfig({enabled: !!b.enabled, level})
                res.writeHead(200)
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500)
                res.end(JSON.stringify({error: e.message}))
            }
            return
        }
    }
    // ── POST /api/config/caveman/update —— 下载并替换 Caveman SKILL.md ──
    if (req.method === 'POST' && url.pathname === '/api/config/caveman/update') {
        try {
            const b = await readBody(req)
            const version = (b.version || '').trim()
            if (!version) { res.writeHead(400); res.end(JSON.stringify({error: 'version required'})); return }
            await downloadAndReplaceCaveman(version)
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, version}))
        } catch (e) {
            log.error({err: e}, 'Caveman 更新失败')
            res.writeHead(500)
            res.end(JSON.stringify({error: e.message}))
        }
        return
    }
    // ── GET/PUT /api/config/rtk —— RTK Bash 压缩配置 ──
    // 功能说明: GET 返回 rtk 配置 + 版本更新信息 + 可用版本列表；PUT 全量写入 enabled
    //   配置存 settings.json → bashCompress: {enabled}
    //   版本存 dynamicCache → rtkUpdate + rtkReleases
    // 关键数据流: GET → loadRtkConfig() + dynamicCache → 200 {enabled, rtkAvailable, rtkUpdate, releases}
    //   PUT {enabled} → saveRtkConfig → 200 {ok:true}
    if (url.pathname === '/api/config/rtk') {
        if (req.method === 'GET') {
            const cfg = loadRtkConfig()
            const rtkPath = locateRtk()
            res.writeHead(200)
            res.end(JSON.stringify({
                enabled: cfg.enabled,
                rtkAvailable: !!rtkPath,
                rtkCurrent: dynamicCache.rtkCurrent || null,
                rtkUpdate: dynamicCache.rtkUpdate || null,
                releases: dynamicCache.rtkReleases || [],
            }))
            return
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req)
                saveRtkConfig({enabled: !!b.enabled})
                res.writeHead(200)
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500)
                res.end(JSON.stringify({error: e.message}))
            }
            return
        }
    }
    // ── POST /api/config/rtk/update —— 下载并替换 RTK 二进制 ──
    // 功能说明: 从 GitHub 下载指定版本 → 解压 → 替换本地二进制 + version.txt
    //   仅管理员操作；下载约 120s 超时
    // 关键数据流: POST {version: "v0.42.4"} → downloadAndReplaceRtk → 200 {ok, version}
    if (req.method === 'POST' && url.pathname === '/api/config/rtk/update') {
        try {
            const b = await readBody(req)
            const version = (b.version || '').trim()
            if (!version) { res.writeHead(400); res.end(JSON.stringify({error: 'version required'})); return }
            await downloadAndReplaceRtk(version)
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, version}))
        } catch (e) {
            log.error({err: e}, 'RTK 更新失败')
            res.writeHead(500)
            res.end(JSON.stringify({error: e.message}))
        }
        return
    }
    // ── GET /api/config/hooks —— 列出所有 Hooks ──
    // 功能说明: 从 settings.json 中读取 hooks 配置，同时读取 ~/.claude-desktop-bridge/hooks/ 下对应的脚本文件内容
    //   返回按事件类型分组的 hooks 列表，每个 hook 包含对应的脚本文件内容
    // 实现方式: readJSON settings.json → 提取 hooks 字段 → 遍历匹配 hooks 目录下实际脚本 → 嵌入 content
    // 关键数据流: settings.json hooks → 匹配 hooks/ 目录文件 → 200 {hooks: {eventType: [{matcher, hooks:[{command, filename, content}]}]}}
    if (req.method === 'GET' && url.pathname === '/api/config/hooks') {
        const hp = join(BRIDGE_HOME, 'settings.json');
        const hd = join(BRIDGE_HOME, 'hooks');
        const hooks = {};
        try {
            const s = readJSON(hp);
            if (s?.hooks) {
                for (const [et, entries] of Object.entries(s.hooks)) {
                    hooks[et] = entries.map(e => ({
                        matcher: e.matcher || '*',
                        timeout: e.timeout || 0,
                        source: 'custom',
                        hooks: (e.hooks || []).map(h => {
                            const fn = basename(h.command?.split(/\s+/).pop() || '');
                            let c = '';
                            try {
                                const hookPath = safeBasename(hd, fn, {extensions: ['.sh', '.js']})
                                if (hookPath) c = readFileSync(hookPath, 'utf8')
                            } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
                            ;
                            return {...h, filename: fn, content: c, source: 'custom'}
                        })
                    }))
                }
            }
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        ;res.writeHead(200);
        res.end(JSON.stringify(hooks));
        return
    }
    const hookFileM = url.pathname.match(/^\/api\/config\/hooks\/([^/]+)$/);
    if (hookFileM) {
        const fn = safeDecodeURIComponent(hookFileM[1]);
        const hd = join(BRIDGE_HOME, 'hooks')
        if (!/^[a-zA-Z0-9_.-]+\.(sh|js)$/.test(fn)) {
            res.writeHead(400)
            res.end(JSON.stringify({error: 'invalid hook filename'}))
            return
        }
        const fp = safeBasename(hd, fn, {extensions: ['.sh', '.js']})
        if (!fp) {
            res.writeHead(400)
            res.end(JSON.stringify({error: 'invalid hook path'}))
            return
        }
        if (req.method === 'GET') {
            try {
                const c = readFileSync(fp, 'utf8');
                res.writeHead(200);
                res.end(JSON.stringify({filename: fn, content: c, size: c.length}))
            } catch {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'not found'}))
            }
            ;
            return
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req);
                backupFile(fp);
                writeFileSync(fp, b.content, 'utf8');
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return
        }
    }
    // ── POST /api/config/hooks —— 创建新 Hook 脚本 ──
    // 功能说明: 在 ~/.claude-desktop-bridge/hooks/ 下创建新的 .sh 或 .js 脚本文件，文件名自动 sanitize
    //   默认填充 #!/usr/bin/env bash + set -euo pipefail 模板
    // 关键数据流: POST {filename, content?} → writeFileSync → 201 {ok:true, filename}
    if (req.method === 'POST' && url.pathname === '/api/config/hooks') {
        try {
            const b = await readBody(req);
            let fn = (b.filename || 'new-hook').trim().replace(/[^a-zA-Z0-9_.-]/g, '-');
            if (!fn.endsWith('.sh') && !fn.endsWith('.js')) fn += '.sh';
            const hd = join(BRIDGE_HOME, 'hooks')
            const fp = safeBasename(hd, fn, {extensions: ['.sh', '.js']})
            if (!fp) {
                res.writeHead(400)
                res.end(JSON.stringify({error: 'invalid hook filename'}))
                return
            }
            if (existsSync(fp)) {
                res.writeHead(409);
                res.end(JSON.stringify({error: 'exists'}));
                return
            }
            if (!existsSync(hd)) mkdirSync(hd, {recursive: true})
            ;writeFileSync(fp, b.content || '#!/usr/bin/env bash\nset -euo pipefail\n', 'utf8');
            res.writeHead(201);
            res.end(JSON.stringify({ok: true, filename: fn}))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}))
        }
        ;
        return
    }
    // ── 内置 Rules 名称集合（与项目 CLAUDE.md 模板一起发布的规则）──
    const BUILTIN_RULES = new Set([
        'avalonia', 'c', 'csharp', 'java', 'vue',
        'reactivity', 'security', 'testing',
        'coding-style',
    ])
    // ── 递归扫描 rules/ 目录下所有 .md 文件 ──
    function scanRulesDir(dir, baseDir, result) {
        for (const entry of readdirSync(dir, {withFileTypes: true})) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                scanRulesDir(full, baseDir, result);
            } else if (entry.name.endsWith('.md')) {
                try {
                    const c = readFileSync(full, 'utf8');
                    const {frontmatter: fm} = parseFrontmatter(c);
                    const relPath = relative(baseDir, full).replace(/\\/g, '/');
                    const stem = entry.name.replace(/\.md$/, '');
                    const isBuiltin = BUILTIN_RULES.has(stem);
                    result.push({filename: relPath, content: c, frontmatter: fm, size: c.length, source: isBuiltin ? 'builtin' : 'custom'})
                } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
            }
        }
    }
    // ── GET /api/config/rules —— 列出所有 Rules ──
    // 功能说明: 递归扫描 ~/.claude-desktop-bridge/rules/ 目录下所有 .md 文件，解析 frontmatter 返回源数据
    //   Rules 为按文件扩展名匹配注入的编码规范
    // 关键数据流: rules/ 目录 → 遍历 .md → parseFrontmatter → 200 {rules: [{filename, content, frontmatter}]}
    if (req.method === 'GET' && url.pathname === '/api/config/rules') {
        const rd = join(BRIDGE_HOME, 'rules');
        const r = [];
        try {
            scanRulesDir(rd, rd, r)
        } catch (error) {
            log.warn({err: error, rulesDir: rd}, '扫描 Rules 目录失败')
        }
        res.writeHead(200);
        res.end(JSON.stringify({rules: r}));
        return
    }
    const ruleM = url.pathname.match(/^\/api\/config\/rules\/(.+)$/);
    if (ruleM) {
        let fn = safeDecodeURIComponent(ruleM[1]);
        const rulesDir = join(BRIDGE_HOME, 'rules')
        const fp = safeChildPath(rulesDir, fn, {extensions: ['.md']})
        if (!fp) {
            res.writeHead(400); res.end(JSON.stringify({error: 'invalid filename'})); return
        }
        if (req.method === 'GET') {
            try {
                const c = readFileSync(fp, 'utf8');
                const {frontmatter: fm} = parseFrontmatter(c);
                res.writeHead(200);
                res.end(JSON.stringify({filename: fn, content: c, frontmatter: fm, size: c.length}))
            } catch {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'not found'}))
            }
            ;
            return
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req);
                if (!existsSync(dirname(fp))) mkdirSync(dirname(fp), {recursive: true});
                backupFile(fp);
                writeFileSync(fp, b.content, 'utf8');
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return
        }
        if (req.method === 'DELETE') {
            try {
                backupFile(fp);
                if (existsSync(fp)) unlinkSync(fp);
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return
        }
    }
    // ── POST /api/config/rules —— 创建新 Rule ──
    // 功能说明: 在 ~/.claude-desktop-bridge/rules/ 下创建新的 .md 规则文件，文件名自动 sanitize
    //   默认模板包含 paths frontmatter 配置
    // 关键数据流: POST {filename, content?, paths?} → writeFileSync → 201 {ok:true, filename}
    if (req.method === 'POST' && url.pathname === '/api/config/rules') {
        try {
            const b = await readBody(req);
            let fn = (b.filename || 'new-rule').trim().replace(/[^a-zA-Z0-9_.-]/g, '-');
            if (!fn.endsWith('.md')) fn += '.md';
            const fp = join(BRIDGE_HOME, 'rules', fn);
            if (existsSync(fp)) {
                res.writeHead(409);
                res.end(JSON.stringify({error: 'exists'}));
                return
            }
            ;writeFileSync(fp, b.content || `---\npaths: "${b.paths || '**/*.*'}"\n---\n\n`, 'utf8');
            res.writeHead(201);
            res.end(JSON.stringify({ok: true, filename: fn}))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}))
        }
        ;
        return
    }
    // ── Agents CRUD（~/.claude-desktop-bridge/agents/<name>.md，frontmatter: name/description/tools/model）──
    if (req.method === 'GET' && url.pathname === '/api/config/agents') {
        const ad = join(BRIDGE_HOME, 'agents');
        const r = [];
        const seen = new Set()
        try {
            for (const fn of readdirSync(ad)) {
                if (!fn.endsWith('.md')) continue
                try {
                    const c = readFileSync(join(ad, fn), 'utf8')
                    const {frontmatter: fm} = parseFrontmatter(c)
                    const name = fm.name || fn.replace(/\.md$/, '')
                    seen.add(name)
                    const isBuiltin = Array.isArray(dynamicCache.agentNames) && dynamicCache.agentNames.includes(name)
                    r.push({
                        filename: fn,
                        name,
                        description: fm.description || '',
                        type: fm.type || '',
                        language: fm.language || '',
                        tools: fm.tools || '',
                        model: fm.model || 'inherit',
                        content: c,
                        size: c.length,
                        loaded: isBuiltin,
                        source: 'custom'
                    }) // 有磁盘文件的始终是自定义
                } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
            }
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        if (Array.isArray(builtinCache.agents)) {
            for (const an of builtinCache.agents) {
                if (!seen.has(an)) r.push({
                    filename: '',
                    name: an,
                    type: BUILTIN_AGENT_TYPES[an] || '',
                    description: '',
                    tools: '',
                    model: 'inherit',
                    content: null,
                    size: 0,
                    loaded: true,
                    source: 'builtin'
                })
            }
        }
        res.writeHead(200);
        res.end(JSON.stringify({agents: r}));
        return
    }
    const agentM = url.pathname.match(/^\/api\/config\/agents\/(.+)$/)
    if (agentM) {
        const an = safeDecodeURIComponent(agentM[1]).replace(/\.md$/, '').replace(/[^a-zA-Z0-9_-]/g, '-')
        const fp = join(BRIDGE_HOME, 'agents', an + '.md')
        if (req.method === 'GET') {
            try {
                const c = readFileSync(fp, 'utf8');
                const {frontmatter: fm} = parseFrontmatter(c);
                res.writeHead(200);
                res.end(JSON.stringify({
                    name: fm.name || an,
                    description: fm.description || '',
                    tools: fm.tools || '',
                    model: fm.model || 'inherit',
                    content: c
                }))
            } catch {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'not found'}))
            }
            ;
            return
        }
        if (req.method === 'PUT') {
            try {
                const b = await readBody(req);
                if (!existsSync(dirname(fp))) mkdirSync(dirname(fp), {recursive: true});
                backupFile(fp);
                writeFileSync(fp, b.content, 'utf8');
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return
        }
        if (req.method === 'DELETE') {
            try {
                backupFile(fp);
                if (existsSync(fp)) unlinkSync(fp);
                res.writeHead(200);
                res.end(JSON.stringify({ok: true}))
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({error: e.message}))
            }
            ;
            return
        }
    }
    // ── POST /api/config/agents —— 创建新 Agent ──
    // 功能说明: 在 ~/.claude-desktop-bridge/agents/ 下创建新的 .md 文件，名称自动 sanitize
    //   默认 frontmatter 模板: tools 留空 = 继承全部工具，model 默认 inherit
    // 关键数据流: POST {name, description?, tools?, model?} → writeFileSync → 201 {ok:true, name}
    if (req.method === 'POST' && url.pathname === '/api/config/agents') {
        try {
            const b = await readBody(req)
            const n = (b.name || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
            if (!n) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'name required'}));
                return
            }
            const ad = join(BRIDGE_HOME, 'agents');
            if (!existsSync(ad)) mkdirSync(ad, {recursive: true})
            const fp = join(ad, n + '.md')
            if (existsSync(fp)) {
                res.writeHead(409);
                res.end(JSON.stringify({error: 'exists'}));
                return
            }
            // 默认 frontmatter 模板：tools 留空表示继承全部工具
            // 字段值去除换行防止 YAML 注入；name 已在上方 sanitize 为 [a-z0-9-]
            const lang = b.language || ''
            const safe = (v) => String(v || '').replace(/[\r\n]/g, ' ')
            const tpl = b.content || `---\nname: ${n}\ntype: ${safe(b.type)}\nlanguage: ${lang}\ndescription: ${safe(b.description)}\ntools: ${safe(b.tools)}\nmodel: ${safe(b.model) || 'inherit'}\n---\n\n`
            writeFileSync(fp, tpl, 'utf8')
            res.writeHead(201);
            res.end(JSON.stringify({ok: true, name: n}));
            return
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}));
            return
        }
    }

    // 动态模型列表：活跃 query 调 supportedModels()，缓存供冷启动；拿不到回退缓存
    // ── GET /api/config/models —— 动态模型列表 ──
    // 功能说明: 通过活跃 query 调用 supportedModels() 获取模型列表（含 value/displayName/description）
    //   有活跃 query 时实时获取并刷新缓存；没有则回退到 dynamicCache 缓存的模型数据
    // 实现方式: getLiveQuery() → withTimeout(q.supportedModels(), 5s) → 更新 dynamicCache + 持久化
    //   5 秒超时保护防止 hang；冷启动无活跃 query 时用磁盘/内存缓存
    // 关键数据流: GET → getLiveQuery() → supportedModels() → dynamicCache.models 更新 + 持久化 → 200 {models, live, cachedAt}
    if (req.method === 'GET' && url.pathname === '/api/config/models') {
        const q = getLiveQuery()
        if (q) {
            try {
                const models = await withTimeout(q.supportedModels(), 5000)  // [{value,displayName,description}]
                if (Array.isArray(models) && models.length) {
                    dynamicCache.models = models;
                    dynamicCache.updatedAt = Date.now();
                    persistDynamicCache()
                }
            } catch (e) {
                log.warn({err: e}, 'supportedModels 失败')
            }
        }
        res.writeHead(200);
        res.end(JSON.stringify({models: dynamicCache.models || [], live: !!q, cachedAt: dynamicCache.updatedAt}));
        return
    }
    // OpenAI 兼容供应商(DeepSeek/OpenAI)的真实模型列表：用配置的 key 调其 /models 接口
    // ── POST /api/config/live-models —— OpenAI 兼容供应商真实模型列表 ──
    // 功能说明: 用请求体中的 baseUrl+apiKey 调供应商的 /models 接口获取真实可用的模型 ID 列表
    // 实现方式: 不同供应商 models 端点位置不同，按 baseUrl 特征判断
    //   8 秒超时保护；失败返回 {models:[], error:...}
    // 关键数据流: POST {baseUrl, apiKey} → 判断供应商 → fetch models 端点 → 解析 data[] → 200 {models, source}
    if (req.method === 'POST' && url.pathname === '/api/config/live-models') {
        try {
            const cliS = loadCliSettings()
            const b = await readBody(req)
            const qBaseUrl = b.baseUrl || ''
            const storedApiKey = cliS.env?.ANTHROPIC_AUTH_TOKEN || cliS.env?.ANTHROPIC_API_KEY || ''
            const qApiKey = restoreSecretValue(b.apiKey || '', storedApiKey)
            // 不再读 process.env：该端点面向 settings 配置查询，cliS.env 已覆盖；临时切换 provider 不经此路径
            const baseUrl = qBaseUrl || cliS.env?.ANTHROPIC_BASE_URL || ''
            const key = qApiKey || storedApiKey
            if (!baseUrl || !key) {
                res.writeHead(200);
                res.end(JSON.stringify({models: [], error: 'no_creds'}));
                return
            }
            if (/\/api\/codex\/backend-api\/codex(?:\/|$)/i.test(baseUrl)) {
                const preset = PROVIDERS.find(provider => provider.id === 'codex-relay')
                const models = (preset?.models || []).map(model => ({value: model.id, displayName: model.name, description: model.contextWindow}))
                res.writeHead(200)
                res.end(JSON.stringify({models, source: 'codex-relay-preset'}))
                return
            }
            // 不同供应商 /models 端点位置不同
            let modelsUrl
            if (baseUrl.includes('dashscope.aliyuncs.com')) {
                modelsUrl = baseUrl.replace(/\/apps\/anthropic\/?$/, '/compatible-mode/v1/models')
            } else if (baseUrl.endsWith('/v1/messages')) {
                modelsUrl = baseUrl.replace(/\/v1\/messages\/?$/, '/v1/models')
            } else if (baseUrl && baseUrl.includes('opencode')) {
                modelsUrl = baseUrl.replace(/\/+$/, '').replace(/\/zen\/v\d+/, '/zen/go/v1') + '/models'
            } else if (baseUrl && baseUrl.includes('minimax')) {
                // MiniMax /anthropic 是 Anthropic 兼容端点，/models 在 OpenAI 兼容路径下
                modelsUrl = baseUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '') + '/v1/models'
            } else {
                modelsUrl = baseUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '') + '/models'
            }
            modelsUrl = buildProviderModelsUrl(baseUrl)
            const providerUrl = await validateProviderUrl(baseUrl)
            await validateProviderUrl(modelsUrl)
            let fetched = await fetchProviderResponse(modelsUrl, {
                headers: {Authorization: `Bearer ${key}`},
                signal: AbortSignal.timeout(8000)
            })
            let r = fetched.response
            modelsUrl = fetched.url
            // 404/403 回退：部分供应商 models 不在根路径
            if (!r.ok && (r.status === 404 || r.status === 403)) {
                try {
                    const candidates = buildProviderFallbackUrls(providerUrl.toString())
                    // 候选：pathBase/v1/models > parentPath/v1/models > origin/v1/models
                    for (const fb of candidates) {
                        if (fb === modelsUrl) continue
                        await validateProviderUrl(fb)
                        const fallback = await fetchProviderResponse(fb, {
                            headers: {Authorization: `Bearer ${key}`},
                            signal: AbortSignal.timeout(8000)
                        })
                        if (fallback.response.ok) { r = fallback.response; modelsUrl = fallback.url; break }
                    }
                } catch (error) {
                    log.debug({err: error, modelsUrl}, '供应商模型端点回退失败')
                }
            }
            if (!r.ok) {
                res.writeHead(200);
                res.end(JSON.stringify({models: [], error: `http_${r.status}`}));
                return
            }
            const d = await r.json()
            const models = (d.data || []).map(m => ({value: m.id, displayName: m.id}))
            res.writeHead(200);
            res.end(JSON.stringify({models, source: modelsUrl}));
            return
        } catch (e) {
            res.writeHead(200);
            res.end(JSON.stringify({models: [], error: String(e?.message || e)}));
            return
        }
    }
    // 供应商连接测试：用请求体中的 baseUrl+apiKey 调 /models 验证连通性
    // ── POST /api/config/test-model —— 供应商连接测试 ──
    // 功能说明: 用请求体中的 baseUrl+apiKey 调供应商 /models 接口验证连通性
    //   返回 ok 状态 + 可选的前 10 个模型 ID 列表，失败时返回 HTTP 状态码和响应摘要
    // 关键数据流: POST {baseUrl, apiKey} → fetch {origin}/models → 200 {ok:true, count, list} 或 {ok:false, error}
    if (req.method === 'POST' && url.pathname === '/api/config/test-model') {
        try {
            const b = await readBody(req)
            const cliS = loadCliSettings()
            const qBaseUrl = b.baseUrl || ''
            const storedApiKey = cliS.env?.ANTHROPIC_AUTH_TOKEN || cliS.env?.ANTHROPIC_API_KEY || ''
            const qApiKey = restoreSecretValue(b.apiKey || '', storedApiKey)
            if (!qBaseUrl || !qApiKey) {
                res.writeHead(200);
                res.end(JSON.stringify({ok: false, error: 'missing baseUrl or apiKey'}));
                return
            }
            if (/\/api\/codex\/backend-api\/codex(?:\/|$)/i.test(qBaseUrl)) {
                const model = typeof b.model === 'string' && /^(?:gpt-|o\d|codex|computer-use)/i.test(b.model) ? b.model : 'gpt-5.6-sol'
                const responsesUrl = qBaseUrl.replace(/\/+$/, '') + '/responses'
                await validateProviderUrl(responsesUrl)
                const probe = await fetchProviderResponse(responsesUrl, {
                    method: 'POST',
                    headers: {Authorization: `Bearer ${qApiKey}`, 'Content-Type': 'application/json'},
                    body: JSON.stringify({model, input: 'Reply with OK only.', stream: false, store: false, max_output_tokens: 4}),
                    signal: AbortSignal.timeout(15000),
                })
                if (!probe.response.ok) {
                    const detail = (await probe.response.text()).slice(0, 300)
                    res.writeHead(200)
                    res.end(JSON.stringify({ok: false, error: `HTTP ${probe.response.status} ${detail}`}))
                    return
                }
                res.writeHead(200)
                res.end(JSON.stringify({ok: true, count: 1, list: [model], source: responsesUrl}))
                return
            }
            // 不同供应商 /models 端点位置不同
            let modelsUrl
            if (qBaseUrl.includes('dashscope.aliyuncs.com')) {
                modelsUrl = qBaseUrl.replace(/\/apps\/anthropic\/?$/, '/compatible-mode/v1/models')
            } else if (qBaseUrl.endsWith('/v1/messages')) {
                modelsUrl = qBaseUrl.replace(/\/v1\/messages\/?$/, '/v1/models')
            } else if (qBaseUrl && qBaseUrl.includes('opencode')) {
                modelsUrl = qBaseUrl.replace(/\/+$/, '').replace(/\/zen\/v\d+/, '/zen/go/v1') + '/models'
            } else if (qBaseUrl && qBaseUrl.includes('minimax')) {
                modelsUrl = qBaseUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '') + '/v1/models'
            } else {
                modelsUrl = qBaseUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '') + '/models'
            }
            modelsUrl = buildProviderModelsUrl(qBaseUrl)
            const providerUrl = await validateProviderUrl(qBaseUrl)
            await validateProviderUrl(modelsUrl)
            let fetched = await fetchProviderResponse(modelsUrl, {
                headers: {Authorization: `Bearer ${qApiKey}`},
                signal: AbortSignal.timeout(10000)
            })
            let r = fetched.response
            modelsUrl = fetched.url
            // 404/403 回退：部分供应商 models 不在根路径
            if (!r.ok && (r.status === 404 || r.status === 403)) {
                try {
                    // 候选：pathBase/v1/models > parentPath/v1/models > origin/v1/models
                    const candidates = buildProviderFallbackUrls(providerUrl.toString())
                    for (const fb of candidates) {
                        if (fb === modelsUrl) continue
                        await validateProviderUrl(fb)
                        const fallback = await fetchProviderResponse(fb, {
                            headers: {Authorization: `Bearer ${qApiKey}`},
                            signal: AbortSignal.timeout(10000)
                        })
                        if (fallback.response.ok) { r = fallback.response; modelsUrl = fallback.url; break }
                    }
                } catch (error) {
                    log.debug({err: error, modelsUrl}, '测试供应商模型端点回退失败')
                }
            }
            if (!r.ok) {
                let detail = `HTTP ${r.status}`
                try {
                    const b = await r.text();
                    if (b) detail += ` — ${b.slice(0, 200)}`
                } catch (error) {
                    log.debug({err: error, modelsUrl}, '读取供应商错误响应失败')
                }
                res.writeHead(200);
                res.end(JSON.stringify({ok: false, error: detail}));
                return
            }
            const d = await r.json()
            const count = Array.isArray(d.data) ? d.data.length : 0
            const list = Array.isArray(d.data) ? d.data.slice(0, 10).map(m => m.id) : []
            res.writeHead(200);
            res.end(JSON.stringify({ok: true, count, list, source: modelsUrl}));
            return
        } catch (e) {
            res.writeHead(200);
            res.end(JSON.stringify({ok: false, error: String(e?.message || e)}));
            return
        }
    }
    // 动态斜杠命令列表：活跃 query 调 supportedCommands()，缓存供冷启动
    // ── GET /api/config/commands —— 动态斜杠命令列表 ──
    // 功能说明: 通过活跃 query 调用 supportedCommands() 获取 Claude Code 内置命令列表
    //   有活跃 query 时实时获取并刷新缓存；没有则回退 dynamicCache 或 BUILTIN_COMMANDS 兜底列表
    // 实现方式: getLiveQuery() → withTimeout(q.supportedCommands(), 5s) → 更新 dynamicCache + 持久化
    //   兜底: BUILTIN_COMMANDS 含 20 个常见命令（help/clear/compact/config/cost/review 等）
    // 关键数据流: GET → getLiveQuery() → supportedCommands() → commands 列表 || BUILTIN_COMMANDS → 200 {commands, live, cachedAt}
    if (req.method === 'GET' && url.pathname === '/api/config/commands') {
        const q = getLiveQuery();
        if (q) {
            try {
                const cmds = await withTimeout(q.supportedCommands(), 5000);
                if (Array.isArray(cmds) && cmds.length) {
                    dynamicCache.commands = cmds;
                    dynamicCache.updatedAt = Date.now();
                    persistDynamicCache()
                }
            } catch (e) {
                log.warn({err: e}, 'supportedCommands 失败')
            }
        }
        ;const commandsList = (dynamicCache.commands?.length ? dynamicCache.commands : null) || BUILTIN_COMMANDS;
        const builtin = commandsList.map(c => ({...c, source: 'builtin'}));
        const custom = IM_CUSTOM_COMMANDS.map(c => ({...c, source: 'custom'}));
        const tagged = [...builtin, ...custom];
        res.writeHead(200);
        res.end(JSON.stringify({commands: tagged, live: !!q, cachedAt: dynamicCache.updatedAt}));
        return
    }


    // ── GET/PUT /api/config/workflow-settings —— 全局 Workflow 开关 ──
    if (url.pathname === '/api/config/workflow-settings') {
        if (req.method === 'GET') {
            res.writeHead(200);
            res.end(JSON.stringify(loadWfConfig()));
            return
        }
        if (req.method === 'PUT') {
            const b = await readBody(req);
            saveWfConfig({...loadWfConfig(), ...b});
            res.writeHead(200);
            res.end(JSON.stringify({ok: true}));
            return
        }
    }


    // ── GET /api/config/providers —— AI 供应商预设列表 ──
    if (req.method === 'GET' && url.pathname === '/api/config/providers') {
        res.writeHead(200);
        res.end(JSON.stringify({providers: PROVIDERS}));
        return;
    }

    // ── HTTP: 定时任务 ──

    // GET /api/config/scheduled-tasks
    if (req.method === 'GET' && url.pathname === '/api/config/scheduled-tasks') {
        const list = Object.entries(scheduledTasks).map(([id, t]) => ({
            id, cron: t.cron, prompt: t.prompt, workDir: t.workDir,
            model: t.model, enabled: t.enabled !== false,
            permissionMode: t.permissionMode || 'default', maxTurns: t.maxTurns || 20,
            running: scheduledRuns.has(id),
        }))
        res.writeHead(200); res.end(JSON.stringify({tasks: list}))
        return
    }
    // POST /api/config/scheduled-tasks
    if (req.method === 'POST' && url.pathname === '/api/config/scheduled-tasks') {
        const b = await readBody(req)
        const id = (b.id || crypto.randomUUID())
        if (typeof id !== 'string' || !/^[a-zA-Z0-9._-]{1,64}$/.test(id)
            || typeof b.cron !== 'string' || b.cron.length > 128
            || typeof b.prompt !== 'string' || !b.prompt.trim() || b.prompt.length > 20_000
            || !isDirectoryPath(b.workDir)) {
            res.writeHead(400); res.end(JSON.stringify({error: 'cron, prompt, workDir required'})); return
        }
        const permissionMode = b.permissionMode || 'default'
        if (!['default', 'acceptEdits', 'plan', 'bypassPermissions'].includes(permissionMode)) {
            res.writeHead(400); res.end(JSON.stringify({error: 'invalid permissionMode'})); return
        }
        const maxTurns = Math.min(100, Math.max(1, Number(b.maxTurns) || 20))
        // validate cron
        if (!cron.validate(b.cron)) { res.writeHead(400); res.end(JSON.stringify({error: 'invalid cron expression'})); return }
        scheduledTasks[id] = {
            cron: b.cron, prompt: b.prompt, workDir: b.workDir,
            model: typeof b.model === 'string' && b.model.length <= 256 ? (b.model || MODEL) : MODEL,
            permissionMode, maxTurns, enabled: b.enabled !== false,
        }
        try {
            if (scheduledTasks[id].enabled) registerScheduledJob(id, b.cron)
            writeJSON(SCHEDULED_TASKS_FILE, scheduledTasks)
        } catch (error) {
            destroyScheduledJob(id)
            delete scheduledTasks[id]
            log.error({err: error, taskId: id}, '创建定时任务失败')
            res.writeHead(500); res.end(JSON.stringify({error: 'failed to create scheduled task'})); return
        }
        res.writeHead(200); res.end(JSON.stringify({ok: true, id}))
        return
    }
    // PUT /api/config/scheduled-tasks/:id
    const schedPutM = url.pathname.match(/^\/api\/config\/scheduled-tasks\/([^/]+)$/)
    if (req.method === 'PUT' && schedPutM) {
        const id = schedPutM[1]
        if (!scheduledTasks[id]) { res.writeHead(404); res.end(JSON.stringify({error: 'not found'})); return }
        const previousTask = {...scheduledTasks[id]}
        const b = await readBody(req)
        if (b.cron !== undefined) {
            if (typeof b.cron !== 'string' || b.cron.length > 128 || !cron.validate(b.cron)) { res.writeHead(400); res.end(JSON.stringify({error: 'invalid cron'})); return }
            scheduledTasks[id].cron = b.cron
        }
        if (b.prompt !== undefined) {
            if (typeof b.prompt !== 'string' || !b.prompt.trim() || b.prompt.length > 20_000) { res.writeHead(400); res.end(JSON.stringify({error: 'invalid prompt'})); return }
            scheduledTasks[id].prompt = b.prompt
        }
        if (b.workDir !== undefined) {
            if (!isDirectoryPath(b.workDir)) { res.writeHead(400); res.end(JSON.stringify({error: 'invalid workDir'})); return }
            scheduledTasks[id].workDir = b.workDir
        }
        if (b.model !== undefined) {
            if (typeof b.model !== 'string' || b.model.length > 256) { res.writeHead(400); res.end(JSON.stringify({error: 'invalid model'})); return }
            scheduledTasks[id].model = b.model
        }
        if (b.permissionMode !== undefined) {
            if (!['default', 'acceptEdits', 'plan', 'bypassPermissions'].includes(b.permissionMode)) { res.writeHead(400); res.end(JSON.stringify({error: 'invalid permissionMode'})); return }
            scheduledTasks[id].permissionMode = b.permissionMode
        }
        if (b.maxTurns !== undefined) scheduledTasks[id].maxTurns = Math.min(100, Math.max(1, Number(b.maxTurns) || 20))
        if (b.enabled !== undefined) scheduledTasks[id].enabled = !!b.enabled
        try {
            if (scheduledTasks[id].enabled) registerScheduledJob(id, scheduledTasks[id].cron)
            else destroyScheduledJob(id)
            writeJSON(SCHEDULED_TASKS_FILE, scheduledTasks)
        } catch (error) {
            scheduledTasks[id] = previousTask
            try {
                if (previousTask.enabled) registerScheduledJob(id, previousTask.cron)
                else destroyScheduledJob(id)
            } catch (restoreError) {
                log.error({err: restoreError, taskId: id}, '恢复旧定时任务失败')
            }
            log.error({err: error, taskId: id}, '更新定时任务失败')
            res.writeHead(500); res.end(JSON.stringify({error: 'failed to update scheduled task'})); return
        }
        res.writeHead(200); res.end(JSON.stringify({ok: true}))
        return
    }
    // DELETE /api/config/scheduled-tasks/:id
    const schedDelM = url.pathname.match(/^\/api\/config\/scheduled-tasks\/([^/]+)$/)
    if (req.method === 'DELETE' && schedDelM) {
        const id = schedDelM[1]
        const previousTask = scheduledTasks[id] ? {...scheduledTasks[id]} : null
        destroyScheduledJob(id)
        delete scheduledTasks[id]
        try {
            writeJSON(SCHEDULED_TASKS_FILE, scheduledTasks)
        } catch (error) {
            if (previousTask) {
                scheduledTasks[id] = previousTask
                try {
                    if (previousTask.enabled) registerScheduledJob(id, previousTask.cron)
                } catch (restoreError) {
                    log.error({err: restoreError, taskId: id}, '恢复已删除定时任务失败')
                }
            }
            log.error({err: error, taskId: id}, '删除定时任务失败')
            res.writeHead(500); res.end(JSON.stringify({error: 'failed to delete scheduled task'})); return
        }
        res.writeHead(200); res.end(JSON.stringify({ok: true}))
        return
    }
    // POST /api/config/scheduled-tasks/:id/run —— 立即执行一次
    const schedRunM = url.pathname.match(/^\/api\/config\/scheduled-tasks\/([^/]+)\/run$/)
    if (req.method === 'POST' && schedRunM) {
        const id = schedRunM[1]
        const task = scheduledTasks[id]
        if (!task) { res.writeHead(404); res.end(JSON.stringify({error: 'not found'})); return }
        if (!task.enabled) { res.writeHead(400); res.end(JSON.stringify({error: 'task is disabled'})); return }
        try {
            const result = await executeScheduledTask(id)
            res.writeHead(result?.started ? 200 : 409)
            res.end(JSON.stringify({ok: !!result?.started, ...result}))
        } catch (e) {
            log.error({err: e, taskId: id}, '手动执行定时任务失败')
            res.writeHead(500)
            res.end(JSON.stringify({error: String(e?.message || e)}))
        }
        return
    }

    // ── POST/DELETE /api/config/adapters/:platform/notifications —— 通知失败恢复 ──
    const notificationRetryMatch = url.pathname.match(/^\/api\/config\/adapters\/([^/]+)\/notifications\/retry$/)
    if (req.method === 'POST' && notificationRetryMatch) {
        const platform = notificationRetryMatch[1]
        if (!ADAPTER_PLATFORMS.includes(platform)) {
            res.writeHead(400); res.end(JSON.stringify({error: 'platform not supported'})); return
        }
        const hook = getAdapterHook(platform)
        if (!hook?.retryNotifications) {
            res.writeHead(409); res.end(JSON.stringify({error: 'adapter is not running'})); return
        }
        const result = hook.retryNotifications()
        res.writeHead(202)
        res.end(JSON.stringify({ok: true, ...result}))
        return
    }

    const notificationDiscardMatch = url.pathname.match(/^\/api\/config\/adapters\/([^/]+)\/notifications\/dead$/)
    if (req.method === 'DELETE' && notificationDiscardMatch) {
        const platform = notificationDiscardMatch[1]
        if (!ADAPTER_PLATFORMS.includes(platform)) {
            res.writeHead(400); res.end(JSON.stringify({error: 'platform not supported'})); return
        }
        const hook = getAdapterHook(platform)
        if (!hook?.discardNotifications) {
            res.writeHead(409); res.end(JSON.stringify({error: 'adapter is not running'})); return
        }
        const result = hook.discardNotifications()
        res.writeHead(200)
        res.end(JSON.stringify({ok: true, ...result}))
        return
    }

    // ── GET/DELETE /api/config/adapters/bindings —— IM 用户与 Session 绑定管理 ──
    if (req.method === 'GET' && url.pathname === '/api/config/adapters/bindings') {
        const bindings = listAdapterBindings(readAdapterBindings(), {
            allowedPlatforms: ADAPTER_PLATFORMS,
            isSessionActive: isAdapterSessionActive,
        })
        res.writeHead(200)
        res.end(JSON.stringify({bindings}))
        return
    }

    if (req.method === 'DELETE' && url.pathname === '/api/config/adapters/bindings') {
        const staleOnly = url.searchParams.get('stale') === '1'
        const deleted = clearAdapterBindings(binding => !staleOnly || !isAdapterSessionActive(binding.sessionId))
        log.info({deleted, staleOnly}, 'IM Session 绑定已清理')
        res.writeHead(200)
        res.end(JSON.stringify({ok: true, deleted}))
        return
    }

    const bindingUserMatch = url.pathname.match(/^\/api\/config\/adapters\/bindings\/([^/]+)\/([^/]+)$/)
    if (req.method === 'DELETE' && bindingUserMatch) {
        const platform = bindingUserMatch[1]
        if (!ADAPTER_PLATFORMS.includes(platform)) {
            res.writeHead(400); res.end(JSON.stringify({error: 'platform not supported'})); return
        }
        let userId
        try {
            userId = safeDecodeURIComponent(bindingUserMatch[2])
        } catch {
            res.writeHead(400); res.end(JSON.stringify({error: 'userId encoding invalid'})); return
        }
        if (!userId || userId.length > 512 || /[\0\r\n]/.test(userId)) {
            res.writeHead(400); res.end(JSON.stringify({error: 'userId invalid'})); return
        }
        const deleted = clearAdapterBindings(binding => binding.platform === platform && binding.userId === userId)
        res.writeHead(200)
        res.end(JSON.stringify({ok: true, deleted}))
        return
    }

    const bindingPlatformMatch = url.pathname.match(/^\/api\/config\/adapters\/bindings\/([^/]+)$/)
    if (req.method === 'DELETE' && bindingPlatformMatch) {
        const platform = bindingPlatformMatch[1]
        if (!ADAPTER_PLATFORMS.includes(platform)) {
            res.writeHead(400); res.end(JSON.stringify({error: 'platform not supported'})); return
        }
        const deleted = clearAdapterBindings(binding => binding.platform === platform)
        log.info({platform, deleted}, 'IM 平台 Session 绑定已清理')
        res.writeHead(200)
        res.end(JSON.stringify({ok: true, deleted}))
        return
    }

    // ── GET /api/config/adapters —— IM 适配器状态列表 ──
    // 功能说明: 返回三个 IM 平台（微信/飞书/钉钉）的配置状态、绑定方式、运行状态
    //   从 adapters.json 读取凭据信息，用 confirmHooks 判断各适配器是否正在运行
    //   前端适配器设置页面依赖此接口展示各平台卡片
    // 关键数据流: GET → adapters.json + confirmHooks 运行状态 → 200 {platforms: [{id, name, status, hasAccount, guideSteps, ...}]}
    if (req.method === 'GET' && url.pathname === '/api/config/adapters') {
        const ad = loadAdapterConfig();
        const runtimeStatus = p => {
            const hook = getAdapterHook(p)
            if (!hook) return {state: 'stopped'}
            try { return hook.connectionStatus?.() || {state: 'running'} } catch (error) {
                return {state: 'error', lastError: String(error?.message || error)}
            }
        }
        const isRunning = p => !['stopped', 'error', 'failed'].includes(runtimeStatus(p).state)
        const notificationStatus = p => {
            const live = confirmHooks.find(h => h.platform === p)?.notificationStatus?.()
            if (live) return live
            if (bridgeStateDb?.available) return bridgeStateDb.summarizeEntries('outbox', p)
            const platformFile = platformEntryFilePath(BRIDGE_HOME, 'bridge-notification-outbox', p)
            return existsSync(platformFile)
                ? readNotificationSummary(platformFile, p)
                : readNotificationSummary(join(BRIDGE_HOME, 'bridge-notification-outbox.json'), p)
        }
        const allBindings = listAdapterBindings(readAdapterBindings(), {
            allowedPlatforms: ADAPTER_PLATFORMS,
            isSessionActive: isAdapterSessionActive,
        })
        const bindingStatus = p => {
            const values = allBindings.filter(binding => binding.platform === p)
            return {
                total: values.length,
                active: values.filter(binding => binding.active).length,
                stale: values.filter(binding => !binding.active).length,
                users: values.map(binding => binding.userId),
            }
        }
        res.writeHead(200);
        res.end(JSON.stringify({
            configError: adapterConfigReadError,
            platforms: [{
                id: 'wechat',
                name: '微信',
                icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
                color: '#07C160',
                bindMethod: 'qr',
                guideTitle: '微信扫码绑定',
                guideSteps: ['1. 微信搜索并关注你的 iLink Bot', '2. 发送任意消息给 Bot', '3. 配对码发给Bot完成绑定'],
                hasAccount: !!(ad.wechat?.botToken),
                accountId: ad.wechat?.accountId || '',
                baseUrl: normalizeWeChatBaseUrl(ad.wechat?.baseUrl),
                pairedUsers: bindingStatus('wechat').users,
                bindings: bindingStatus('wechat'),
                notifications: notificationStatus('wechat'),
                runtime: runtimeStatus('wechat'),
                pairCode: getAdapterHook('wechat')?.pairingCode?.() || '',
                status: adapterConfigReadError ? 'error' : (isRunning('wechat') ? 'running' : (ad.wechat?.botToken ? 'configured' : 'not_configured'))
            }, {
                id: 'feishu',
                name: '飞书',
                icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
                color: '#3370FF',
                bindMethod: 'app_config',
                guideTitle: '飞书企业自建应用接入',
                guideSteps: ['1. 飞书开放平台创建企业自建应用 + 机器人', '2. 获取 App ID + App Secret', '3. 事件订阅 选择「使用长连接接收事件」', '4. 发布版本生效'],
                configFields: [{
                    key: 'appId',
                    label: 'App ID',
                    placeholder: 'cli_xxxxxxxxxxxx',
                    type: 'text'
                }, {key: 'appSecret', label: 'App Secret', placeholder: '输入 App Secret', type: 'password'}],
                hasAccount: !!(ad.feishu?.appId && ad.feishu?.appSecret),
                accountId: ad.feishu?.appId ? ad.feishu.appId.replace(/./g, '●').slice(0, 20) : '',
                baseUrl: ad.feishu?.baseUrl || 'https://open.feishu.cn',
                pairedUsers: bindingStatus('feishu').users,
                bindings: bindingStatus('feishu'),
                notifications: notificationStatus('feishu'),
                runtime: runtimeStatus('feishu'),
                pairCode: getAdapterHook('feishu')?.pairingCode?.() || '',
                status: adapterConfigReadError ? 'error' : (isRunning('feishu') ? 'running' : ((ad.feishu?.appId && ad.feishu?.appSecret) ? 'configured' : 'not_configured'))
            }, {
                id: 'dingtalk',
                name: '钉钉',
                icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 11-3 11h18s-3-4-3-11"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
                color: '#0089FF',
                bindMethod: 'app_config',
                guideTitle: '钉钉企业内部应用接入',
                guideSteps: ['1. 钉钉开发者后台创建企业内部应用', '2. 获取 Client ID + Client Secret', '3. 选择 Stream 模式', '4. 发布版本生效'],
                configFields: [{
                    key: 'appKey',
                    label: 'Client ID',
                    placeholder: 'dingxxxxxxxxxx',
                    type: 'text'
                }, {key: 'appSecret', label: 'Client Secret', placeholder: '输入 App Secret', type: 'password'}],
                hasAccount: !!(ad.dingtalk?.appKey && ad.dingtalk?.appSecret),
                accountId: ad.dingtalk?.appKey ? ad.dingtalk.appKey.replace(/./g, '●').slice(0, 20) : '',
                baseUrl: ad.dingtalk?.baseUrl || 'https://api.dingtalk.com',
                pairedUsers: bindingStatus('dingtalk').users,
                bindings: bindingStatus('dingtalk'),
                notifications: notificationStatus('dingtalk'),
                runtime: runtimeStatus('dingtalk'),
                pairCode: getAdapterHook('dingtalk')?.pairingCode?.() || '',
                status: adapterConfigReadError ? 'error' : (isRunning('dingtalk') ? 'running' : ((ad.dingtalk?.appKey && ad.dingtalk?.appSecret) ? 'configured' : 'not_configured'))
            }]
        }));
        return
    }

    // ── POST /api/config/adapters/wechat/qrcode —— 获取微信 Bot 二维码 ──
    // 功能说明: 调用 iLink API 获取微信 Bot 的绑定二维码，缓存到 pendingQRCodes Map（5 分钟有效期）
    //   前端展示二维码供用户扫码绑定
    // 关键数据流: POST → fetch iLink get_bot_qrcode → 缓存 qrcode + expires → 200 {qrImgUrl, expiresIn}
    if (req.method === 'POST' && url.pathname.startsWith('/api/config/adapters/') && url.pathname.endsWith('/qrcode')) {
        const pid = url.pathname.split('/')[4];
        if (pid !== 'wechat') {
            res.writeHead(400);
            res.end(JSON.stringify({error: 'platform not supported'}));
            return
        }
        ;
        try {
            const r = await fetch('https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3', {
                headers: {
                    'AuthorizationType': 'ilink_bot_token',
                    'iLink-App-Id': 'bot',
                    'iLink-App-ClientVersion': '853081'
                }, signal: AbortSignal.timeout(10000)
            });
            const q = await r.json();
            if (!q.qrcode) {
                res.writeHead(500);
                res.end(JSON.stringify({error: 'qrcode not found'}));
                return
            }
            ;pendingQRCodes.set(pid, {qrcode: q.qrcode, expires: Date.now() + 300000});
            res.writeHead(200);
            res.end(JSON.stringify({
                ok: true,
                qrImgUrl: `https://quickchart.io/qr?text=${encodeURIComponent(q.qrcode_img_content || q.qrcode)}&size=300`,
                expiresIn: 300
            }))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}))
        }
        ;
        return
    }
    // ── POST /api/config/adapters/wechat/qrcode/poll —— 轮询二维码状态 ──
    // 功能说明: 轮询微信二维码绑定状态，确认后自动保存 botToken 到 adapters.json + channels/ 账号缓存
    //   前端在展示二维码后定时轮询此接口直到 status === 'confirmed'
    // 关键数据流: POST → fetch iLink get_qrcode_status → confirmed? 保存 token + 清理 pending → 200 {status:'confirmed'}
    //   未确认 → 200 {status:'wait'}
    if (req.method === 'POST' && url.pathname.includes('/qrcode/poll')) {
        const pid = url.pathname.split('/')[4];
        const p = pendingQRCodes.get(pid);
        if (!p) {
            res.writeHead(400);
            res.end(JSON.stringify({error: 'no pending qrcode'}));
            return
        }
        ;
        try {
            const r = await fetch(`https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(p.qrcode)}`, {
                headers: {
                    'AuthorizationType': 'ilink_bot_token',
                    'iLink-App-Id': 'bot',
                    'iLink-App-ClientVersion': '853081'
                }, signal: AbortSignal.timeout(5000)
            });
            const s = await r.json();
            if (s.status === 'confirmed' && s.bot_token) {
                const a = loadAdapterConfig({strict: true});
                const credentialsChanged = a.wechat?.botToken !== s.bot_token
                a.wechat = {
                    ...(a.wechat || {}),
                    botToken: s.bot_token,
                    accountId: s.ilink_bot_id,
                    baseUrl: normalizeWeChatBaseUrl(s.baseurl)
                };
                saveAdapterConfig(a);
                if (credentialsChanged) clearAdapterPlatformState('wechat')
                pendingQRCodes.delete(pid);
                restartAdapter('wechat')
                ;res.writeHead(200);
                res.end(JSON.stringify({status: 'confirmed'}))
            } else {
                res.writeHead(200);
                res.end(JSON.stringify({status: s.status || 'wait'}))
            }
        } catch {
            res.writeHead(200);
            res.end(JSON.stringify({status: 'wait'}))
        }
        ;
        return
    }
    // ── PUT /api/config/adapters/:id —— 更新适配器凭据 ──
    // 功能说明: 保存飞书/钉钉的 App ID + Secret 到 adapters.json
    // 关键数据流: PUT {appId, appSecret} / {appKey, appSecret} → 写入 adapters.json → 200 {ok:true}
    const apm = url.pathname.match(/^\/api\/config\/adapters\/([^/]+)$/);
    if (req.method === 'PUT' && apm) {
        const pid = apm[1];
        try {
            if (!['feishu', 'dingtalk'].includes(pid)) {
                res.writeHead(400); res.end(JSON.stringify({error: 'unsupported platform'})); return
            }
            const b = await readBody(req);
            const a = loadAdapterConfig({strict: true});
            const appId = String(pid === 'feishu' ? b.appId || '' : b.appKey || '').trim()
            const appSecret = String(b.appSecret || '').trim()
            if (!appId || !appSecret || appId.length > 512 || appSecret.length > 1024 || /[\0\r\n]/.test(appId + appSecret)) {
                res.writeHead(400); res.end(JSON.stringify({error: 'invalid adapter credentials'})); return
            }
            const previous = a[pid] || {}
            const credentialsChanged = pid === 'feishu'
                ? previous.appId !== appId || previous.appSecret !== appSecret
                : previous.appKey !== appId || previous.appSecret !== appSecret
            if (pid === 'feishu') a.feishu = {...previous, appId, appSecret}
            else a.dingtalk = {...previous, appKey: appId, appSecret}
            saveAdapterConfig(a)
            if (credentialsChanged) clearAdapterPlatformState(pid)
            const hook = restartAdapter(pid)
            res.writeHead(200);
            res.end(JSON.stringify({ok: true, running: !!hook}))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}))
        }
        ;
        return
    }
    // ── DELETE /api/config/adapters/:id —— 删除适配器配置 ──
    // 功能说明: 从 adapters.json 移除指定平台的凭据配置，同时清理 ~/.claude-desktop-bridge/channels/ 下的账号缓存目录
    // 关键数据流: DELETE → 移除 adapters.json[platform] + 清理 channels/ 目录 → 200 {ok:true}
    if (req.method === 'DELETE' && apm) {
        const pid = apm[1];
        try {
            if (!ADAPTER_PLATFORMS.includes(pid)) {
                res.writeHead(400); res.end(JSON.stringify({error: 'platform not supported'})); return
            }
            const a = loadAdapterConfig({strict: true});
            delete a[pid];
            saveAdapterConfig(a)
            const cleaned = clearAdapterPlatformState(pid)
            // 同时清理 channels 目录下的账号缓存
            try {
                const cd = join(BRIDGE_HOME, 'channels', pid);
                if (existsSync(cd)) rmSync(cd, {recursive: true, force: true})
            } catch (error) {
                log.warn({err: error, platform: pid}, '清理 IM 账号缓存失败')
            }
            ;res.writeHead(200);
            res.end(JSON.stringify({ok: true, cleaned}))
        } catch (e) {
            log.error({err: e}, 'adapters DELETE 失败');
            res.writeHead(500);
            res.end(JSON.stringify({ok: false, error: String(e?.message || e)}))
        }
        ;
        return
    }
    // ── GET /api/config/mcp —— MCP 插件列表 ──
    // 功能说明: 从 ~/.claude-desktop-bridge/plugins/installed_plugins.json 读取已安装的 MCP 插件信息
    // 关键数据流: GET → readJSON installed_plugins.json → 200 {plugins: [{name, version, scope, enabled}]}
    // ── GET /api/config/mcp —— MCP 插件列表 ──
    // 功能说明: 合并硬编码内置 MCP + installed_plugins.json 用户安装的插件
    // 关键数据流: BUILTIN_MCP 打底 → 叠加 installed_plugins.json → 200 {plugins}
    if (req.method === 'GET' && url.pathname === '/api/config/mcp') {
        const s = readJSON(join(BRIDGE_HOME, 'settings.json')) || {}
        const disabledList = s.disabledMcpPlugins || []
        const pj = join(BRIDGE_HOME, 'plugins', 'installed_plugins.json')
        const pm = new Map()
        for (const [k, v] of Object.entries(BUILTIN_MCP)) {
            pm.set(k, {name: k, version: v.version, scope: v.scope, enabled: !disabledList.includes(k), source: 'builtin'})
        }
        try {
            const d = readJSON(pj)
            if (d?.plugins) {
                for (const [k, vs] of Object.entries(d.plugins)) {
                    for (const v of vs) {
                        const src = v.scope === 'user' || v.scope === 'project' ? 'custom' : 'builtin'
                        pm.set(k, {name: k, version: v.version, scope: v.scope, enabled: !disabledList.includes(k), source: src})
                    }
                }
            }
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        res.writeHead(200)
        res.end(JSON.stringify({plugins: [...pm.values()]}))
        return
    }

    // ── GET /api/config/mcp-servers —— MCP 服务器配置列表 ──
    // 功能说明: 从 settings.json 读取 mcpServers 配置，返回服务器列表（名称/transport/command/参数等）
    // 关键数据流: GET → loadCliSettings().mcpServers → 200 {servers: [{name, transport, command, args, env, url, headers}]}
    if (req.method === 'GET' && url.pathname === '/api/config/mcp-servers') {
        const cliS = loadCliSettings()
        const servers = cliS.mcpServers || {}
        const list = Object.entries(servers).map(([name, cfg]) => ({
            name,
            transport: cfg.type || cfg.transport || 'stdio',
            command: cfg.command || '',
            args: cfg.args || [],
            env: redactSecretMap(cfg.env),
            url: cfg.url || '',
            headers: redactSecretMap(cfg.headers),
            enabled: cfg.enabled !== false,
        }))
        res.writeHead(200)
        res.end(JSON.stringify({servers: list}))
        return
    }

    // ── POST /api/config/mcp-servers —— 新增/更新 MCP 服务器 ──
    // 功能说明: 写入 settings.json 的 mcpServers 字段，支持新增和覆盖已有服务器
    //   校验 name 必填，transport 合法（stdio/sse/http）；已有同名校验后覆盖
    // 关键数据流: POST {name, transport, command, args, env, url, headers}
    //   → readJSON settings.json → 更新 mcpServers[name] → writeJSON → 200 {ok:true}
    if (req.method === 'POST' && url.pathname === '/api/config/mcp-servers') {
        try {
            const body = await readBody(req)
            const name = (body.name || '').trim()
            if (!name) { res.writeHead(400); res.end(JSON.stringify({error: 'name 必填'})); return }
            if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name)) {
                res.writeHead(400); res.end(JSON.stringify({error: 'MCP 名称只能包含字母、数字、点、下划线和连字符'})); return
            }
            const transport = body.transport || 'stdio'
            if (!['stdio', 'sse', 'http'].includes(transport)) {
                res.writeHead(400); res.end(JSON.stringify({error: 'transport 需为 stdio/sse/http'})); return
            }
            const s = loadCliSettingsForUpdate()
            if (!s.mcpServers) s.mcpServers = {}
            const existing = s.mcpServers[name] || {}
            const cfg = {type: transport}
            if (body.enabled !== undefined) cfg.enabled = !!body.enabled
            else if (existing.enabled !== undefined) cfg.enabled = existing.enabled
            if (transport === 'stdio') {
                const command = typeof body.command === 'string' ? body.command.trim() : ''
                if (!command || command.length > 2048 || /[\0\r\n]/.test(command)) {
                    res.writeHead(400); res.end(JSON.stringify({error: 'stdio command 无效或超长'})); return
                }
                const args = body.args === undefined ? [] : body.args
                if (!Array.isArray(args) || args.length > 100 || args.some(a => typeof a !== 'string' || a.length > 4096 || /[\0\r\n]/.test(a))) {
                    res.writeHead(400); res.end(JSON.stringify({error: 'stdio args 必须是最多 100 个安全字符串'})); return
                }
                const envInput = body.env === undefined && (existing.type || existing.transport || 'stdio') === transport
                    ? existing.env || {}
                    : body.env === undefined ? {} : body.env
                const env = restoreSecretMap(envInput, existing.env || {})
                if (!env || typeof env !== 'object' || Array.isArray(env) || Object.keys(env).length > 50) {
                    res.writeHead(400); res.end(JSON.stringify({error: 'stdio env 格式无效'})); return
                }
                for (const [key, value] of Object.entries(env)) {
                    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || value.length > 4096 || /[\0\r\n]/.test(value)) {
                        res.writeHead(400); res.end(JSON.stringify({error: 'stdio env 包含非法键值'})); return
                    }
                    if (['BRIDGE_TOKEN', 'BRIDGE_ALLOW_TOKEN_ENDPOINT', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key)) {
                        res.writeHead(400); res.end(JSON.stringify({error: `禁止覆盖运行时变量 ${key}`})); return
                    }
                }
                cfg.command = command
                cfg.args = args
                if (Object.keys(env).length) cfg.env = env
            } else {
                if (typeof body.url !== 'string' || body.url.length > 4096) {
                    res.writeHead(400); res.end(JSON.stringify({error: 'MCP URL 无效'})); return
                }
                let parsedUrl
                try { parsedUrl = new URL(body.url) } catch {
                    res.writeHead(400); res.end(JSON.stringify({error: 'MCP URL 无效'})); return
                }
                if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                    res.writeHead(400); res.end(JSON.stringify({error: 'MCP URL 仅支持 http/https'})); return
                }
                const headersInput = body.headers === undefined && (existing.type || existing.transport) === transport
                    ? existing.headers || {}
                    : body.headers === undefined ? {} : body.headers
                const headers = restoreSecretMap(headersInput, existing.headers || {})
                if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.keys(headers).length > 50) {
                    res.writeHead(400); res.end(JSON.stringify({error: 'MCP headers 格式无效'})); return
                }
                for (const [key, value] of Object.entries(headers)) {
                    if (!/^[\x21-\x7e]{1,128}$/.test(key) || typeof value !== 'string' || value.length > 4096 || /[\0\r\n]/.test(value)) {
                        res.writeHead(400); res.end(JSON.stringify({error: 'MCP headers 包含非法键值'})); return
                    }
                    if (key.toLowerCase() === 'x-bridge-token') {
                        res.writeHead(400); res.end(JSON.stringify({error: '禁止转发 Gateway token'})); return
                    }
                }
                cfg.url = body.url
                if (Object.keys(headers).length) cfg.headers = headers
            }
            s.mcpServers[name] = cfg
            writeJSON(join(BRIDGE_HOME, 'settings.json'), s)
            log.info({name, transport}, 'MCP 服务器已保存')
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, name}))
        } catch (e) {
            log.error({err: e}, 'MCP 服务器保存失败')
            res.writeHead(500); res.end(JSON.stringify({ok: false, error: String(e?.message || e)}))
        }
        return
    }

    // ── DELETE /api/config/mcp-servers/:name —— 删除 MCP 服务器 ──
    // 功能说明: 从 settings.json 的 mcpServers 中删除指定名称的服务器配置
    // 关键数据流: DELETE /api/config/mcp-servers/:name → delete mcpServers[name] → writeJSON → 200 {ok:true}
    const delMcpM = url.pathname.match(/^\/api\/config\/mcp-servers\/([^/]+)$/)
    if (req.method === 'DELETE' && delMcpM) {
        try {
            const name = safeDecodeURIComponent(delMcpM[1])
            if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name)) {
                res.writeHead(400); res.end(JSON.stringify({error: 'MCP 名称无效'})); return
            }
            const s = loadCliSettingsForUpdate()
            if (s.mcpServers) {
                delete s.mcpServers[name]
                writeJSON(join(BRIDGE_HOME, 'settings.json'), s)
            }
            log.info({name}, 'MCP 服务器已删除')
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, name}))
        } catch (e) {
            log.error({err: e}, 'MCP 服务器删除失败')
            res.writeHead(500); res.end(JSON.stringify({ok: false, error: String(e?.message || e)}))
        }
        return
    }

    // ── POST /api/wechat/send —— 主动推送消息到微信 ──
    // 功能说明: 前端手动推送文本消息到指定微信用户，自动分段发送长文本
    // 实现方式: 从 adapters.json 或 channels/ 获取 botToken → sendWeChatChunks 分段发送
    // 关键数据流: POST {userId, text} → 取 token → sendWeChatChunks → 200 {sent, parts}
    if (req.method === 'POST' && url.pathname === '/api/wechat/send') {
        try {
            const {userId, text} = await readBody(req);
            if (!userId || !text) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'userId and text required'}));
                return
            }
            ;let t, u;
            try {
                const a = loadAdapterConfig({strict: true});
                t = a.wechat?.botToken;
                u = normalizeWeChatBaseUrl(a.wechat?.baseUrl)
            } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
            ;
            if (!t) {
                try {
                    const a = readJSON(join(BRIDGE_HOME, 'channels', 'wechat', 'default', 'account.json'));
                    t = a.token;
                    u = normalizeWeChatBaseUrl(a.baseUrl)
                } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
            }
            ;
            if (!t) {
                res.writeHead(500);
                res.end(JSON.stringify({error: 'wechat bot token not configured'}));
                return
            }
            ;const bn = u.replace(/\/+$/, '') + '/';
            const r = await sendWeChatChunks(bn, t, userId, '', text);
            res.writeHead(200);
            res.end(JSON.stringify({sent: r.sent, parts: r.parts}))
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({error: e.message}))
        }
        ;
        return
    }
    // 微信通道确认回复入口
    // ── POST /api/confirm —— 微信通道确认响应入口 ──
    // 功能说明: 微信 IM 消息通过此接口提交用户对权限/方案选择的确认结果
    //   查找 session 的 pending entry，将决策转换为 PermissionResult，调用 settlePending 收口
    // 实现方式: readBody → 查找 s.pending.get(requestId) → decisionToResult 映射 → settlePending(sid, requestId, result, 'wechat')
    // 关键数据流: POST {sessionId, requestId, decision/optionIndex} → s.pending 查找
    //   → decisionToResult → settlePending → 200 {ok:true} 或 {ok:false, reason:'already_resolved'}
    if (req.method === 'POST' && url.pathname === '/api/confirm') {
        const b = await readBody(req);
        const {sessionId: sid, requestId, decision, optionIndex, questionIndex} = b
        const identity = getAdapterIdentity(req)
        const s = sessions.get(sid)
        const entry = s?.pending?.get(requestId)
        if (!entry) {
            res.writeHead(200);
            res.end(JSON.stringify({ok: false, reason: 'already_resolved'}));
            return
        }
        const ownsRequest = !!identity && (entry.userId
            ? entry.source === identity.source && entry.userId === identity.userId
            : adapterOwnsSession(identity.source, identity.userId, sid))
        if (!ownsRequest) {
            res.writeHead(403)
            res.end(JSON.stringify({error: 'confirmation ownership mismatch'}))
            return
        }
        const result = entry.type === 'choice'
            ? decisionToResult(entry, null, optionIndex, questionIndex)
            : decisionToResult(entry, decision)
        settlePending(sid, requestId, result, identity.source)
        res.writeHead(200);
        res.end(JSON.stringify({ok: true}));
        return
    }

    // ── GET /api/config/memory-summary —— 项目记忆摘要 ──
    // 功能说明: 扫描所有项目的 memory/ 目录，返回每个项目的工作目录路径和记忆文件列表
    //   前端设置页 Memory 面板依赖此接口展示各项目的记忆文件
    // 实现方式: 遍历 ~/.claude-desktop-bridge/projects/ → 读 memory/ 目录 → 从 .jsonl 解析真实 cwd
    // 关键数据流: GET → 遍历 projects/ → 200 {projects: [{workDir, fileCount, files}]}
    if (req.method === 'GET' && url.pathname === '/api/config/memory-summary') {
        const bp = join(BRIDGE_HOME, 'projects');
        const rs = [];
        try {
            for (const ed of readdirSync(bp)) {
                // 跳过非项目目录（无 jsonl session 记录）
                // 过滤子 agent 转录文件，仅以主 session .jsonl 判断项目存在性
                let jls = readdirSync(join(bp, ed)).filter(f => f.endsWith('.jsonl') && !f.startsWith('.trash-') && !f.startsWith('agent-') && !f.startsWith('wf-agent-'));
                // 白名单二次过滤: 排除 UUID 命名的 agent transcript
                jls = jls.filter(f => !isAgentTranscriptByContent(join(bp, ed, f)));
                if (!jls.length) continue;
                const md = join(bp, ed, 'memory');
                const fl = existsSync(md) ? readdirSync(md).filter(f => f.endsWith('.md')) : [];
                let wd = decodeProjectName(ed) || ed;
                try {
                    const c = readFileSync(join(bp, ed, jls[0]), 'utf8');
                    const cm = c.match(/"cwd":\s*"([^"]+)"/);
                    if (cm) wd = cm[1].replace(/\\/g, '/')
                } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
                ;rs.push({
                    workDir: wd,
                    encodedDir: ed,
                    fileCount: fl.length,
                    files: fl.map(f => ({filename: f, size: statSync(join(md, f)).size}))
                })
            }
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        ;rs.sort((a, b) => b.fileCount - a.fileCount);
        res.writeHead(200);
        res.end(JSON.stringify({projects: rs}));
        return
    }
    // ── GET /api/balance —— 可选余额查询 ──
    // 只有 DeepSeek 有稳定且已知的余额契约；其他供应商返回明确的降级状态，
    // 不把第三方 token 误发到 DeepSeek 导致 401 和全局“服务处理失败”提示。
    if (req.method === 'GET' && url.pathname === '/api/balance') {
        try {
            const cliS = loadCliSettings();
            const provider = resolveBalanceProvider(cliS.env?.ANTHROPIC_BASE_URL)
            const baseResponse = {
                balance: 0,
                currency: 'CNY',
                used: 0,
                supported: provider.supported,
                provider: provider.id,
            }
            if (!provider.supported) {
                res.writeHead(200);
                res.end(JSON.stringify({...baseResponse, reason: provider.reason, message: provider.message}))
                return
            }
            const k = cliS.env?.ANTHROPIC_AUTH_TOKEN || cliS.env?.ANTHROPIC_API_KEY;
            if (!k) {
                res.writeHead(200);
                res.end(JSON.stringify({...baseResponse, supported: false, reason: 'missing_credentials', message: '未配置 API Key'}));
                return
            }
            const r = await fetch(provider.endpoint, {
                headers: {Authorization: `Bearer ${k}`},
                signal: AbortSignal.timeout(5000)
            });
            if (!r.ok) {
                res.writeHead(200);
                res.end(JSON.stringify({...baseResponse, supported: false, reason: r.status === 401 ? 'auth_failed' : 'upstream_error', message: `余额接口返回 HTTP ${r.status}`}));
                return
            }
            const d = await r.json();
            res.writeHead(200);
            res.end(JSON.stringify({...baseResponse, ...parseDeepSeekBalance(d)}))
        } catch (error) {
            log.debug({err: error}, '余额查询失败，已按可选能力降级')
            res.writeHead(200);
            res.end(JSON.stringify({balance: 0, currency: 'CNY', used: 0, supported: false, provider: 'unknown', reason: 'unreachable', message: '余额接口暂时不可用'}))
        }
        ;
        return
    }

    // ── POST /api/sessions-by-label —— IM 命令专用：按项目名查会话
    // body: { label: 'claude-desktop-bridge' }
    // 一次调用完成"查项目→查session"，返回 {ok, label, sessions}
    if (req.method === 'POST' && url.pathname === '/api/sessions-by-label') {
        const b = await readBody(req)
        const identity = getAdapterIdentity(req)
        const binding = identity ? readAdapterBindings()[`${identity.source}:${identity.userId}`] : null
        if (!identity || !binding) {
            res.writeHead(403); res.end(JSON.stringify({error: 'session ownership mismatch'})); return
        }
        const label = (b.label || '').toLowerCase()
        if (!label) { res.writeHead(400); res.end(JSON.stringify({error: 'label required'})); return }
        const projects = await scanProjects()
        let match = projects.find(p => {
            const dn = (p.workDir || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
            return dn.toLowerCase() === label
        })
        if (!match) {
            match = projects.find(p => {
                const dn = (p.workDir || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
                return dn.toLowerCase().includes(label) || (p.workDir || '').toLowerCase().includes(label)
            })
        }
        if (!match) { res.writeHead(200); res.end(JSON.stringify({ok: true, label: b.label, sessions: []})); return }
        const projectSessions = await listProjectSessions(match.encodedDir)
        const ownedSession = focusedSessionId ? sessions.get(focusedSessionId) : null
        const ownedId = ownedSession?.lastSessionId || binding.sessionId
        const owned = projectSessions.filter(item => item.id === ownedId)
        res.writeHead(200); res.end(JSON.stringify({ok: true, label: b.label, sessions: owned.map(s => ({id: s.id, title: s.title}))})); return
    }

    // ── GET /api/projects —— 扫描所有项目 ──
    // 功能说明: 扫描 ~/.claude-desktop-bridge/projects/ 目录，返回所有项目的列表（含 session 摘要和最后活跃时间）
    //   去重按 workDir 合并多 session 的同一项目
    // 关键数据流: GET → scanProjects() → 200 {projects: [{workDir, sessionCount, sessions, lastActive}]}
    if (req.method === 'GET' && url.pathname === '/api/projects') {
        const identity = getAdapterIdentity(req)
        const allProjects = await scanProjects();
        let projects = allProjects
        if (identity) {
            const binding = readAdapterBindings()[`${identity.source}:${identity.userId}`]
            if (!binding) {
                res.writeHead(403); res.end(JSON.stringify({error: 'session ownership mismatch'})); return
            }
            projects = allProjects.filter(project => project.workDir === binding.workDir)
        }
        res.writeHead(200);
        res.end(JSON.stringify({projects}));
        return
    }
    const psm = url.pathname.match(/^\/api\/projects\/([^/]+)\/sessions$/);
    if (req.method === 'GET' && psm) {
        const encodedDir = safeDecodeURIComponent(psm[1])
        if (!encodedDir || basename(encodedDir) !== encodedDir) {
            res.writeHead(400); res.end(JSON.stringify({error: 'invalid project'})); return
        }
        const identity = getAdapterIdentity(req)
        if (identity && !adapterOwnsProject(identity, encodedDir)) {
            res.writeHead(403); res.end(JSON.stringify({error: 'project ownership mismatch'})); return
        }
        const sessions = await listProjectSessions(encodedDir);
        res.writeHead(200);
        res.end(JSON.stringify({sessions}));
        return
    }
    const msm = url.pathname.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/messages$/);
    if (req.method === 'GET' && msm) {
        const identity = getAdapterIdentity(req)
        if (identity && !adapterOwnsProject(identity, msm[1])) {
            res.writeHead(403); res.end(JSON.stringify({error: 'project ownership mismatch'})); return
        }
        const location = findSessionTranscript({bridgeHome: BRIDGE_HOME, encodedDir: msm[1], sessionId: msm[2]})
        if (location.status === 'invalid') {
            res.writeHead(400); res.end(JSON.stringify({error: 'invalid project or session'})); return
        }
        if (location.status === 'ambiguous') {
            log.error({sessionId: msm[2].slice(0, 8), matches: location.matches}, '会话 transcript 目录存在歧义')
            res.writeHead(409); res.end(JSON.stringify({error: '会话 transcript 目录存在歧义', code: 'HISTORY_LOCATION_AMBIGUOUS'})); return
        }
        if (location.status !== 'found') {
            res.writeHead(404); res.end(JSON.stringify({error: '历史会话不存在', code: 'HISTORY_NOT_FOUND'})); return
        }
        if (identity && !adapterOwnsProject(identity, location.encodedDir)) {
            res.writeHead(403); res.end(JSON.stringify({error: 'project ownership mismatch'})); return
        }
        let messages
        try {
            messages = parseSessionHistory(readFileSync(location.filePath, 'utf8'))
        } catch (error) {
            log.warn({err: error, sessionId: msm[2].slice(0, 8), encodedDir: location.encodedDir}, '读取会话历史失败')
            res.writeHead(500); res.end(JSON.stringify({error: '历史会话读取失败', code: 'HISTORY_READ_FAILED'})); return
        }
        res.writeHead(200);
        res.end(JSON.stringify({messages, encodedDir: location.encodedDir}));
        return
    }

    // ── GET /api/projects/:encodedDir/memory —— 读取项目所有 memory 文件 ──
    const projMemM = url.pathname.match(/^\/api\/projects\/([^/]+)\/memory$/);
    if (req.method === 'GET' && projMemM) {
        const ed = safeDecodeURIComponent(projMemM[1]);
        try {
            const result = listProjectMemory({
                bridgeHome: BRIDGE_HOME,
                encodedDir: ed,
                workDir: decodeProjectName(ed) || ed,
                memoryService,
                query: url.searchParams.get('q') || '',
            })
            res.writeHead(200)
            res.end(JSON.stringify(result))
        } catch (error) {
            log.warn({err: error, encodedDir: ed}, '读取项目 Memory 失败')
            res.writeHead(error.statusCode || 500)
            res.end(JSON.stringify({error: error.message, code: error.code || 'MEMORY_LIST_FAILED'}))
        }
        return
    }
    const projMemRebuildM = url.pathname.match(/^\/api\/projects\/([^/]+)\/memory\/rebuild$/)
    if (req.method === 'POST' && projMemRebuildM) {
        const ed = safeDecodeURIComponent(projMemRebuildM[1])
        try {
            const result = rebuildProjectMemory({
                workDir: decodeProjectName(ed) || ed,
                encodedDir: ed,
                memoryService,
            })
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, ...result}))
        } catch (error) {
            res.writeHead(error.statusCode || 500)
            res.end(JSON.stringify({error: error.message, code: error.code || 'MEMORY_REBUILD_FAILED'}))
        }
        return
    }
    const projMemStatusM = url.pathname.match(/^\/api\/projects\/([^/]+)\/memory\/([^/]+)\/status$/)
    if (req.method === 'PUT' && projMemStatusM) {
        const ed = safeDecodeURIComponent(projMemStatusM[1])
        const fn = safeDecodeURIComponent(projMemStatusM[2])
        const body = await readBody(req)
        try {
            const result = setProjectMemoryEnabled({encodedDir: ed, filename: fn, enabled: body.enabled, memoryService})
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, ...result}))
        } catch (error) {
            res.writeHead(error.statusCode || 500)
            res.end(JSON.stringify({error: error.message, code: error.code || 'MEMORY_STATUS_FAILED'}))
        }
        return
    }
    // ── PUT/DELETE /api/projects/:encodedDir/memory/:filename —— 创建、编辑或删除 Memory 文件 ──
    const projMemFileM = url.pathname.match(/^\/api\/projects\/([^/]+)\/memory\/([^/]+)$/);
    if (req.method === 'PUT' && projMemFileM) {
        const ed = safeDecodeURIComponent(projMemFileM[1]);
        const fn = safeDecodeURIComponent(projMemFileM[2]);
        const body = await readBody(req);
        try {
            const result = saveProjectMemory({
                bridgeHome: BRIDGE_HOME,
                encodedDir: ed,
                workDir: decodeProjectName(ed) || ed,
                filename: fn,
                content: body.content,
                memoryService,
            })
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, ...result}))
        } catch (error) {
            res.writeHead(error.statusCode || 500)
            res.end(JSON.stringify({error: error.message, code: error.code || 'MEMORY_SAVE_FAILED'}))
        }
        return
    }
    if (req.method === 'DELETE' && projMemFileM) {
        const ed = safeDecodeURIComponent(projMemFileM[1]);
        const fn = safeDecodeURIComponent(projMemFileM[2]);
        try {
            const result = deleteProjectMemory({bridgeHome: BRIDGE_HOME, encodedDir: ed, filename: fn, memoryService})
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, ...result}))
        } catch (error) {
            res.writeHead(error.statusCode || 500)
            res.end(JSON.stringify({error: error.message, code: error.code || 'MEMORY_DELETE_FAILED'}))
        }
        return
    }

    // ── Workflow 脚本 CRUD ( ~/.claude-desktop-bridge/workflows/*.mjs ) ──
    // GET  /api/workflows          → 列出所有脚本
    // GET  /api/workflows/:name    → 读取脚本内容
    // PUT  /api/workflows/:name    → 保存脚本
    // DELETE /api/workflows/:name → 删除脚本
    // POST /api/workflows/:name/run → 执行脚本
    // GET  /api/workflows/history → 查询执行历史
    if (url.pathname === '/api/workflows/history' && req.method === 'GET') {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200)
        const history = queryHistory(limit)
        res.writeHead(200)
        res.end(JSON.stringify({history}))
        return
    }
    // GET  /api/workflows/:name/state → 查询运行状态
    if (url.pathname === '/api/workflows' && req.method === 'GET') {
        const list = listWorkflows();
        res.writeHead(200);
        res.end(JSON.stringify({workflows: list}));
        return
    }
    const wfRunM = url.pathname.match(/^\/api\/workflows\/([^/]+)\/run$/)
    if (req.method === 'POST' && wfRunM) {
        const name = safeDecodeURIComponent(wfRunM[1])
        try {
            const body = await readBody(req);
            const sid = body.sessionId
            if (!sid || !sessions.has(sid)) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'sessionId 无效'}));
                return
            }
            if (!getWorkflow(name)) {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'Workflow 不存在'}));
                return
            }
            const wfCfg = loadWfConfig()
            if (!wfCfg.enabled) {
                res.writeHead(403);
                res.end(JSON.stringify({error: 'Workflow 功能已禁用，请在 Workflow 面板开启'}));
                return
            }
            const runKey = `${name}:${sid}`
            presetRunState(name, runKey, sid)
            broadcastTaskLifecycle(sid)
            runWfScript(name, sid, {...(body.args || {}), _runKey: runKey, _taskOwned: false}).catch(e => {
                broadcast(sid, {type: 'workflow_error', workflowName: name, error: e.message})
            })
            res.writeHead(202);
            res.end(JSON.stringify({ok: true, name}))
        } catch (e) {
            res.writeHead(e.code === 'WORKFLOW_ALREADY_RUNNING' ? 409 : 500);
            res.end(JSON.stringify({error: e.message}))
        }
        return
    }
    const wfStateM = url.pathname.match(/^\/api\/workflows\/([^/]+)\/state$/)
    if (req.method === 'GET' && wfStateM) {
        const state = getRunState(safeDecodeURIComponent(wfStateM[1]))
        res.writeHead(200);
        res.end(JSON.stringify(state || {status: 'not_run', logs: [], phases: []}))
        return
    }
    // POST /api/workflows/:name/stop → 暂停运行中的工作流
    const wfStopM = url.pathname.match(/^\/api\/workflows\/([^/]+)\/stop$/)
    if (req.method === 'POST' && wfStopM) {
        const name = safeDecodeURIComponent(wfStopM[1])
        const body = await readBody(req).catch(() => ({}))
        const sid = typeof body.sessionId === 'string' && sessions.has(body.sessionId) ? body.sessionId : null
        const runKey = sid ? `${name}:${sid}` : name
        if (body.mode === 'commit') {
            try {
                const r = await commitWorkflow(runKey)
                if (sid) broadcastTaskLifecycle(sid)
                res.writeHead(200)
                res.end(JSON.stringify({ok: true, name, ...r}))
            } catch (e) {
                res.writeHead(400)
                res.end(JSON.stringify({error: e.message}))
            }
            return
        }
        const ok = stopWorkflow(runKey)
        if (sid) broadcastTaskLifecycle(sid)
        res.writeHead(ok ? 200 : 404);
        res.end(JSON.stringify(ok ? {ok: true, name, status: 'paused'} : {error: 'not running'}))
        return
    }
    // POST /api/workflows/:name/resume → 恢复暂停的工作流
    const wfResumeM = url.pathname.match(/^\/api\/workflows\/([^/]+)\/resume$/)
    if (req.method === 'POST' && wfResumeM) {
        const name = safeDecodeURIComponent(wfResumeM[1])
        try {
            const body = await readBody(req);
            const sid = body.sessionId
            if (!sid || !sessions.has(sid)) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'sessionId 无效'}));
                return
            }
            if (!getWorkflow(name)) {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'Workflow 不存在'}));
                return
            }
            const wfCfg = loadWfConfig()
            if (!wfCfg.enabled) {
                res.writeHead(403);
                res.end(JSON.stringify({error: 'Workflow 功能已禁用，请在 Workflow 面板开启'}));
                return
            }
            const runKey = `${name}:${sid}`
            presetRunState(name, runKey, sid)
            broadcastTaskLifecycle(sid)
            const override = {}
            if (body.budgetMax != null) override.budgetMax = Number(body.budgetMax)
            resumeWorkflow(name, sid, override, runKey).catch(e => {
                broadcast(sid, {type: 'workflow_error', workflowName: name, error: e.message})
            })
            res.writeHead(202);
            res.end(JSON.stringify({ok: true, name, status: 'resumed'}))
        } catch (e) {
            res.writeHead(e.code === 'WORKFLOW_ALREADY_RUNNING' ? 409 : 500);
            res.end(JSON.stringify({error: e.message}))
        }
        return
    }
    // POST /api/workflows/:name/agents/:label/stop → 单 agent 独立暂停
    const wfAgentStopM = url.pathname.match(/^\/api\/workflows\/([^/]+)\/agents\/([^/]+)\/stop$/)
    if (req.method === 'POST' && wfAgentStopM) {
        const wfName = safeDecodeURIComponent(wfAgentStopM[1])
        const agentLabel = safeDecodeURIComponent(wfAgentStopM[2])
        const body = await readBody(req).catch(() => ({}))
        const state = getRunState(typeof body.workflowId === 'string' ? body.workflowId : wfName)
        if (!state) { res.writeHead(404); res.end(JSON.stringify({error: 'workflow 未运行'})); return }
        const wfId = state.wfId
        const ok = stopWorkflowAgent(wfId, agentLabel)
        res.writeHead(ok ? 200 : 404);
        res.end(JSON.stringify({ok, agentLabel}))
        return
    }
    // POST /api/workflows/:name/agents/:label/resume → 单 agent 独立恢复
    const wfAgentResumeM = url.pathname.match(/^\/api\/workflows\/([^/]+)\/agents\/([^/]+)\/resume$/)
    if (req.method === 'POST' && wfAgentResumeM) {
        const wfName = safeDecodeURIComponent(wfAgentResumeM[1])
        const agentLabel = safeDecodeURIComponent(wfAgentResumeM[2])
        const body = await readBody(req).catch(() => ({}))
        const state = getRunState(typeof body.workflowId === 'string' ? body.workflowId : wfName)
        if (!state) { res.writeHead(404); res.end(JSON.stringify({error: 'workflow 未运行'})); return }
        const ok = resumeWorkflowAgent(state.wfId, agentLabel)
        res.writeHead(ok ? 200 : 404)
        res.end(JSON.stringify({ok, agentLabel}))
        return
    }
    const wfFileM = url.pathname.match(/^\/api\/workflows\/([^/]+)$/)
    if (wfFileM) {
        const name = safeDecodeURIComponent(wfFileM[1])
        if (req.method === 'GET') {
            const content = getWorkflow(name);
            const meta = content ? parseMeta(content) : null
            if (!content) {
                res.writeHead(404);
                res.end(JSON.stringify({error: 'not found'}));
                return
            }
            res.writeHead(200);
            res.end(JSON.stringify({name, content, meta}));
            return
        }
        if (req.method === 'PUT') {
            const body = await readBody(req)
            try {
                validateWorkflowContent(body.content)
            } catch (error) {
                res.writeHead(error?.code === 'WORKFLOW_SCRIPT_TOO_LARGE' ? 413 : 400)
                res.end(JSON.stringify({error: error?.message || 'Workflow 内容无效'}))
                return
            }
            // 安全校验：sessionId 有则验证，没有则要求至少一个活跃 session
            if (body.sessionId) {
                if (!sessions.has(body.sessionId)) {
                    res.writeHead(400);
                    res.end(JSON.stringify({error: 'sessionId 无效'}));
                    return
                }
            } else if (sessions.size === 0) {
                res.writeHead(403);
                res.end(JSON.stringify({error: '无活跃会话，请先创建工作区'}));
                return
            }
            saveWorkflow(name, body.content);
            res.writeHead(200);
            res.end(JSON.stringify({ok: true, name}));
            return
        }
        if (req.method === 'DELETE') {
            const body = await readBody(req).catch(() => ({}))
            // 安全校验：同 PUT
            if (body.sessionId) {
                if (!sessions.has(body.sessionId)) {
                    res.writeHead(400);
                    res.end(JSON.stringify({error: 'sessionId 无效'}));
                    return
                }
            } else if (sessions.size === 0) {
                res.writeHead(403);
                res.end(JSON.stringify({error: '无活跃会话，请先创建工作区'}));
                return
            }
            deleteWorkflowFile(name);
            res.writeHead(200);
            res.end(JSON.stringify({ok: true}));
            return
        }
    }

    if (!res.headersSent) {
        res.writeHead(404);
        res.end(JSON.stringify({error: 'not found'}))
    }
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
    if (!listWorkflows().some(w => w.name.replace('.mjs', '') === workflow)) {
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
        if (error?.code !== 'WORKFLOW_ALREADY_RUNNING') log.warn({err: error, sessionId: sessionId?.slice(0, 8)}, '最终复核预注册失败')
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
            _returnToParent: false,
            _runKey: runKey,
        })
        if (result?.paused) {
            const transition = updateTaskCompletion(s, sessionId, {type: 'review_paused', detail: '最终审查已暂停，可恢复后继续'})
            await applyTaskCompletionEffects(sessionId, transition.effects)
            return
        }
        const outcome = normalizeReviewOutcome(result, plan, {files: checkpoint.files})
        const transition = updateTaskCompletion(s, sessionId, {type: 'review_result', outcome})
        await applyTaskCompletionEffects(sessionId, transition.effects)
    } catch (error) {
        log.error({err: error, sessionId: sessionId?.slice(0, 8), workflow}, '最终复核失败')
        const transition = updateTaskCompletion(s, sessionId, {type: 'review_error', detail: String(error?.message || error)})
        await applyTaskCompletionEffects(sessionId, transition.effects)
    }
}

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

// ---- WebSocket ----
// 控制通道客户端池：独立于 session，用于接收 nudge 等全局事件
const controlClients = new Set()

async function submitTaskCommand(command) {
    const sessionId = command.sessionId
    const s = sessions.get(sessionId)
    if (!s) return {type: 'message_rejected', messageId: command.messageId, code: 'session_not_found'}
    if (s._stopPromise) await s._stopPromise

    const source = command.source
    const userId = command.userId || null
    const desktopInput = !IM_SOURCES.has(source)
    const activeTurnInput = Boolean(s._generating || s.activeTurnId || s._pendingInputs?.length)
    let acceptedInput = null
    let acceptedEventPersisted = false
    try {
        // 供应商只在回合边界刷新，避免补充消息中断正在执行的工具。
        if (!activeTurnInput) {
            const fresh = loadCliSettings()
            const key = fresh.env?.ANTHROPIC_AUTH_TOKEN || fresh.env?.ANTHROPIC_API_KEY || ''
            const url = fresh.env?.ANTHROPIC_BASE_URL || ''
            const prevUrl = s.providerBaseUrl || ''
            const prevKey = s.providerApiKey || ''
            if ((url && url !== prevUrl) || (key && key !== prevKey)) {
                if (s.queryOpts) s.queryOpts.model = null
                s.runtimeEnv = s.runtimeEnv || {}
                s.runtimeEnv.ANTHROPIC_BASE_URL = url
                s.runtimeEnv.ANTHROPIC_AUTH_TOKEN = key
                s.providerBaseUrl = url
                s.providerApiKey = key
                log.info({sessionId: sessionId.slice(0, 8), baseUrl: url?.slice(0, 40)}, '厂商配置变更，将重建 query')
            }
        }

        const cliSettingsForDecision = loadCliSettings()
        const requestedModelMode = desktopInput && VALID_MODEL_MODES.has(command.modelMode)
            ? command.modelMode
            : (s.modelMode || (command.model ? 'fixed' : 'auto'))
        const taskDecision = activeTurnInput && s.taskDecision
            ? s.taskDecision
            : decideTask({
                text: desktopInput && command.taskText?.trim() ? command.taskText : command.content,
                previousDecision: s.taskDecision,
                diffRisk: s.lastDiffRisk,
                attachmentEvidence: desktopInput && command.hasAttachments,
            })
        const taskRoute = resolveTurnModelRoute({
            activeTurn: activeTurnInput,
            currentMode: s.modelMode,
            currentModel: s.queryOpts?.model,
            currentTier: s.modelTier,
            modelMode: requestedModelMode,
            explicitModel: requestedModelMode === 'fixed' ? (command.model || s.queryOpts?.model) : '',
            decision: taskDecision,
            modelTiers: loadWfConfig().modelTiers,
            defaultModel: cliSettingsForDecision.model || s.queryOpts?.model || MODEL,
        })
        if (taskRoute.blockingReason) {
            return {
                type: 'message_rejected', messageId: command.messageId, code: taskRoute.blockingReason,
                message: taskRoute.blockingReason === 'power_model_required'
                    ? '当前高风险任务需要先配置 Power 模型'
                    : '当前供应商没有可用模型',
            }
        }
        const providerBaseUrl = cliSettingsForDecision.env?.ANTHROPIC_BASE_URL || s.providerBaseUrl || ''
        const compatibilityError = activeTurnInput ? null : validateProviderModel({baseUrl: providerBaseUrl, model: taskRoute.model})
        if (compatibilityError) {
            return {
                type: 'message_rejected', messageId: command.messageId, code: compatibilityError,
                message: '当前 Codex Relay 不支持所选模型，请在设置中为该档位配置 Codex 模型',
            }
        }
        if (!activeTurnInput) s.providerBaseUrl = providerBaseUrl

        const previousModelMode = s.modelMode || (s.queryOpts?.model ? 'fixed' : 'auto')
        acceptedInput = acceptSessionInput(s, source, command.messageId, userId, taskDecision)
        if (!acceptedInput.ok) {
            return acceptedInput.duplicate
                ? {type: 'message_duplicate', messageId: acceptedInput.messageId}
                : {type: 'message_rejected', messageId: command.messageId, code: acceptedInput.error, queuePosition: acceptedInput.queuePosition || 0}
        }
        try {
            appendSessionEvent(s, 'task/accepted', {
                source,
                messageId: acceptedInput.messageId,
                turnId: acceptedInput.turnId,
                queuePosition: acceptedInput.queuePosition,
            }, {critical: true})
            acceptedEventPersisted = true
        } catch (error) {
            rollbackSessionInput(s, acceptedInput)
            acceptedInput = null
            log.error({err: error, sessionId: sessionId.slice(0, 8), source}, '任务接收事件持久化失败，已拒绝输入')
            return {
                type: 'message_rejected', messageId: command.messageId, code: 'session_event_persist_failed',
                message: '任务状态无法持久化，请检查磁盘后重试',
            }
        }

        if (!s.visibleSource && isUserSessionSource(source)) {
            if (!markVisibleSession(s.workDir, sessionId, s.lastSessionId, source)) {
                rollbackSessionInput(s, acceptedInput)
                appendSessionEvent(s, 'task/rolled-back', {turnId: acceptedInput.turnId, reason: 'session_visibility_persist_failed'})
                acceptedInput = null
                return {type: 'message_rejected', messageId: command.messageId, code: 'session_visibility_persist_failed'}
            }
            s.visibleSource = source
            if (s.lastSessionId) {
                broadcastDesktop(sessionId, {
                    type: 'session_visible', sessionId, historySessionId: s.lastSessionId, source,
                })
            }
        }

        if (!activeTurnInput) {
            s.taskStartedAt = Date.now()
            s.taskCompletedAt = 0
            s.taskCompletion = createTaskCompletionState({phase: 'running'})
            s.taskCompletionDecision = taskDecision
            s.taskCompletionIdentity = createTurnIdentity(source, userId, IM_SOURCES)
            s.taskFinalReplyText = ''
            s.taskReviewFiles = []
            s.taskReviewCheckpointId = null
            s._finalReviewKey = null
            s.taskCompletionTurnId = acceptedInput.turnId
            s.taskCompletionTaskId = `${sessionId}:${acceptedInput.turnId}`
            s._taskCompletionSequence = 0
            s._taskWorkflowGate = createTaskWorkflowGate()
            s._internalWorkflowResultTurnId = null
            s._autoContinuationRequest = null
            s.autoContinuationCount = 0
            s.autoContinuationTurns = 0
            s._lastContextUsageAt = 0
        }

        // 只在新任务入口观察候选；同一执行中的补充消息不能把一次要求误计为多次偏好。
        let preferenceSuggestions = []
        if (!activeTurnInput) {
            try {
                preferenceSuggestions = userPreferences.observe({
                    projectDir: s.workDir,
                    taskId: s.taskCompletionTaskId || acceptedInput.turnId,
                    sessionId,
                    source,
                    text: desktopInput && command.taskText?.trim() ? command.taskText : command.content,
                })
            } catch (error) {
                log.warn({err: error, sessionId: sessionId.slice(0, 8)}, '用户偏好候选观察失败，继续执行任务')
            }
        }

        updateTaskState(s, sessionId, {
            status: 'running', outcome: null, continuationReason: null,
            resumable: Boolean(s.lastSessionId), sdkSessionId: s.lastSessionId, historySessionId: s.lastSessionId,
            taskId: s.taskCompletionTaskId || null, turnId: s.taskCompletionTurnId || null,
            sequence: s._taskCompletionSequence || 0, startedAt: s.taskStartedAt || Date.now(),
            completedAt: 0, durationMs: 0,
        })
        if (!activeTurnInput) {
            taskCompletionEventForClient(s, sessionId, 'task_started', {
                modelTier: taskDecision.modelTier, risk: taskDecision.risk,
            })
        }
        s.taskDecision = taskDecision
        s.modelTier = taskRoute.tier || null
        broadcast(sessionId, {
            type: 'task_decision', version: taskDecision.version, action: taskDecision.action,
            complexity: taskDecision.complexity, risk: taskDecision.risk, modelTier: taskDecision.modelTier,
            model: taskRoute.model, modelMode: taskRoute.mode, workflow: taskDecision.workflow,
            finalReview: taskDecision.finalReview, reasons: taskDecision.reasons,
            hardTriggers: taskDecision.hardTriggers, fallbackReason: taskRoute.fallbackReason,
            inheritedFromActiveTurn: taskRoute.inheritedFromActiveTurn, ts: Date.now(),
        })
        log.info({sessionId: sessionId.slice(0, 8), source, textLength: command.content.length}, '← 用户消息')
        if (IM_SOURCES.has(source)) {
            broadcastDesktop(sessionId, {type: 'remote_user_message', source, content: command.content})
        }
        for (const suggestion of preferenceSuggestions) {
            broadcastDesktop(sessionId, {type: 'preference_suggestion', suggestion})
        }
        s._pendingSources = s._pendingSources || []
        s._pendingSources.push(source)

        const srcLabel = IM_SOURCES.has(source) ? `[${source}] ` : ''
        const newPerm = IM_SOURCES.has(source) ? 'default' : command.permissionMode
        const newThink = command.thinkingLevel
        const newModel = taskRoute.model
        const nextProfile = taskDecision.contextProfile
        const permChanged = newPerm && newPerm !== s.permissionMode
        const thinkChanged = newThink && newThink !== s.thinkingLevel
        const modelChanged = newModel && newModel !== s.queryOpts?.model
        const modeChanged = taskRoute.mode !== previousModelMode
        const contextChanged = nextProfile !== (s.contextProfile || 'full')
        const sdkInputContent = resolveSdkInputContent(sessionId, s, command.content)
        const nextSkillRoute = routeSkills({text: sdkInputContent, workDir: s.workDir, profile: nextProfile})
        const skillRouteChanged = JSON.stringify(nextSkillRoute) !== JSON.stringify(s.skillRoute || [])
        beginTurn(sessionId, srcLabel + command.content, {
            captureFiles: shouldCaptureTurnCheckpoint(taskDecision),
        })

        if (permChanged || thinkChanged || modelChanged || modeChanged || contextChanged || skillRouteChanged) {
            if (permChanged) s.permissionMode = newPerm
            if (thinkChanged) s.thinkingLevel = newThink
            if (modelChanged) {
                s.queryOpts.model = newModel
                if (command.modelMeta) s.modelMeta = command.modelMeta
            }
            if (contextChanged) s.contextProfile = nextProfile
            if (skillRouteChanged) s.skillRoute = nextSkillRoute
            await closeSessionRuntime(s, {sessionId, reason: 'runtime_settings_changed'})
            s.query = null
            s.pushStream = null
            s._rebuildPromise = null
            s._rebuildId = null
            if (s._hasConversation) s.lastSessionId = s.lastSessionId || sessionId
        }
        s.modelMode = taskRoute.mode

        if (!s.query) {
            if (s._rebuildPromise) {
                if (!s._pendingMessages) s._pendingMessages = []
                s._pendingMessages.push(sdkInputContent)
            } else {
                s._pendingMessages = [sdkInputContent]
                const myRebuildId = Symbol('rebuild')
                s._rebuildId = myRebuildId
                s._rebuildPromise = (async () => {
                    const cliS = loadCliSettings()
                    const rebuildPushStream = new PushStream()
                    s.pushStream = rebuildPushStream
                    const bodyOverride = {
                        resume: s.hasUserTurns ? (s.lastSessionId || undefined) : undefined,
                        model: s.queryOpts?.model, modelMode: s.modelMode || 'fixed',
                        taskDecision: s.taskDecision || null, permissionMode: s.permissionMode,
                        thinkingLevel: s.thinkingLevel, contextProfile: s.contextProfile || 'full',
                        skillRoute: s.skillRoute || [], modelMeta: command.modelMeta,
                    }
                    if (s.providerBaseUrl) bodyOverride.baseUrl = s.providerBaseUrl
                    if (s.providerApiKey) bodyOverride.apiKey = s.providerApiKey
                    const opts = await makeQueryOptions(bodyOverride, s.workDir, cliS, {}, sessionId)
                    if (s._rebuildId !== myRebuildId || s.pushStream !== rebuildPushStream) return
                    if (bodyOverride.resume) opts.resume = bodyOverride.resume
                    s.query = startClaudeAgent(rebuildPushStream, opts)
                    s.runtimeEnv = opts.runtimeEnv
                    s.providerBaseUrl = opts.bridgeProviderBaseUrl || s.providerBaseUrl
                    s.providerApiKey = opts.bridgeProviderApiKey || s.providerApiKey
                    s.queryOpts = opts
                    startStreamPump(sessionId)
                    const pending = s._pendingMessages || []
                    s._pendingMessages = null
                    for (const content of pending) {
                        rebuildPushStream.push({
                            type: 'user', session_id: sessionId,
                            message: {role: 'user', content: [{type: 'text', text: content}]},
                            parent_tool_use_id: null,
                        })
                        s.hasUserTurns = true
                    }
                    s._rebuildPromise = null
                    s._rebuildId = null
                })().catch(error => {
                    if (s._rebuildId !== myRebuildId) {
                        log.debug({err: error, sessionId: sessionId.slice(0, 8)}, '已过期 rebuild 失败，忽略其状态清理')
                        return
                    }
                    log.error({err: error, sessionId: sessionId.slice(0, 8)}, 'rebuild 失败')
                    s._rebuildPromise = null
                    s._rebuildId = null
                    s._pendingMessages = null
                    failPendingSessionInputs(sessionId, s, error)
                })
            }
        } else {
            s.pushStream.push({
                type: 'user', session_id: sessionId,
                message: {role: 'user', content: [{type: 'text', text: sdkInputContent}]},
                parent_tool_use_id: null,
            })
            s.hasUserTurns = true
        }

        if (!command.noWorkflow && !activeTurnInput) {
            autoTriggerWorkflow(sessionId, command.content, taskDecision).catch(error => {
                log.warn({err: error, sessionId: sessionId.slice(0, 8)}, 'autoTriggerWorkflow 异常')
            })
        }
        const result = {
            type: 'message_accepted', messageId: acceptedInput.messageId,
            turnId: acceptedInput.turnId, queuePosition: acceptedInput.queuePosition,
        }
        acceptedInput = null
        return result
    } catch (error) {
        if (acceptedInput && rollbackSessionInput(s, acceptedInput)) {
            const sourceIndex = s._pendingSources?.lastIndexOf(source) ?? -1
            if (sourceIndex >= 0) s._pendingSources.splice(sourceIndex, 1)
            if (acceptedEventPersisted) appendSessionEvent(s, 'task/rolled-back', {
                turnId: acceptedInput.turnId,
                reason: typeof error?.code === 'string' ? error.code.slice(0, 120) : 'submit_failed',
            })
        }
        throw error
    }
}

const wss = new WebSocketServer({noServer: true, maxPayload: 1048576})

function rejectWebSocketUpgrade(socket, statusCode, reason) {
    const text = String(reason || 'Forbidden').replace(/[\r\n]/g, ' ').slice(0, 100)
    socket.write(`HTTP/1.1 ${statusCode} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    socket.destroy()
}

httpServer.on('upgrade', (req, socket, head) => {
    if (typeof req.url !== 'string' || req.url.length > 4096) {
        rejectWebSocketUpgrade(socket, 414, 'URI Too Long')
        return
    }
    let parsed
    try {
        parsed = new URL(req.url, `ws://127.0.0.1:${PORT}`)
    } catch {
        rejectWebSocketUpgrade(socket, 400, 'Bad Request')
        return
    }
    if (!/^\/ws\/(control\/?|[^/]+)$/.test(parsed.pathname)) {
        rejectWebSocketUpgrade(socket, 404, 'Not Found')
        return
    }
    const auth = authenticateBridgeToken(extractWebSocketToken(req))
    if (!auth) {
        rejectWebSocketUpgrade(socket, 401, 'Unauthorized')
        return
    }
    const source = parsed.searchParams.get('source') || 'desktop'
    const userId = req.headers['x-bridge-user-id']
    if (auth.kind === 'adapter') {
        if (source !== auth.platform || req.headers['x-bridge-source'] !== auth.platform || typeof userId !== 'string'
            || !userId || userId.length > 512 || /[\0\r\n]/.test(userId)) {
            rejectWebSocketUpgrade(socket, 403, 'Forbidden')
            return
        }
        if (parsed.pathname === '/ws/control' || parsed.pathname === '/ws/control/') {
            rejectWebSocketUpgrade(socket, 403, 'Forbidden')
            return
        }
    } else if (IM_SOURCES.has(source)) {
        rejectWebSocketUpgrade(socket, 403, 'Forbidden')
        return
    }
    req.bridgeWsAuth = auth
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
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
wsPingTimer.unref()
wss.on('connection', (ws, req) => {
    const wsAuth = req.bridgeWsAuth
    if (!wsAuth) {
        ws.close(4003, JSON.stringify({error: 'forbidden: missing or invalid bridge token'}))
        return
    }
    const urlStr = req.url || '';
    const qi = urlStr.indexOf('?')
    const pathPart = qi >= 0 ? urlStr.slice(0, qi) : urlStr;
    const qPart = qi >= 0 ? urlStr.slice(qi + 1) : ''
    const sessionId = pathPart.split('/').pop()
    const params = {};
    for (const p of qPart.split('&')) {
        const [k, v] = p.split('=');
        if (k) params[safeDecodeURIComponent(k)] = safeDecodeURIComponent(v || '')
    }
    if (wsAuth.kind === 'adapter' && params.source !== wsAuth.platform) {
        ws.close(4003, JSON.stringify({error: 'adapter source mismatch'}))
        return
    }
    // 控制通道：不绑定 session，桌面端启动即连，用于接收 nudge 事件
    if (pathPart === '/ws/control' || pathPart === '/ws/control/') {
        if (wsAuth.kind !== 'desktop') {
            ws.close(4003, JSON.stringify({error: 'adapter control channel not allowed'}))
            return
        }
        ws._source = 'desktop'
        controlClients.add(ws)
        ws._lastPong = Date.now()
        ws.on('pong', () => { ws._lastPong = Date.now() })
        ws.send(JSON.stringify({type: 'control_connected'}))
        ws.on('close', () => { controlClients.delete(ws) })
        return
    }
    if (!sessionId || !sessions.has(sessionId)) {
        ws.close(4000, JSON.stringify({error: 'unknown session'}));
        return
    }
    const source = params.source || 'desktop'
    if (IM_SOURCES.has(source)) {
        const userId = req.headers['x-bridge-user-id']
        if (wsAuth.kind !== 'adapter' || typeof userId !== 'string' || !adapterOwnsSession(source, userId, sessionId)) {
            ws.close(4003, JSON.stringify({error: 'session ownership mismatch'}))
            return
        }
        ws._adapterUserId = userId
    }
    const s = sessions.get(sessionId);
    s.clients.add(ws)
    ws._source = source
    if (params.source === 'desktop') focusedSessionId = sessionId
    ws.send(JSON.stringify({
        type: 'connected',
        sessionId,
        mirrorEnabled: IM_SOURCES.has(source) ? !!s.mirrors?.[source] : false,
        mirrors: s.mirrors || {wechat: false, feishu: false, dingtalk: false},
    }))
    if (params.source === 'desktop') {
        ws.send(JSON.stringify({type: 'session_state_snapshot', ...getSessionRuntimeState(s), taskState: taskStateForSessionClient(s)}))
        const lifecycleSnapshot = getTaskLifecycleSnapshot(sessionId, s)
        if (lifecycleSnapshot) ws.send(JSON.stringify({type: 'session_lifecycle_snapshot', ...lifecycleSnapshot}))
        for (const suggestion of userPreferences.pending(s.workDir)) {
            ws.send(JSON.stringify({type: 'preference_suggestion', suggestion}))
        }
    }
    // 切换 tab 重连时发送当前 workflow/agent 运行态快照，供前端恢复 agent 面板
    if (params.source === 'desktop') {
        try {
            const wfState = getSessionWorkflowState(sessionId)
            if (wfState) {
                ws.send(JSON.stringify({type: 'workflow_state_snapshot', ...wfState}))
            }
        } catch (error) {
            log.debug({err: error, sessionId: sessionId?.slice(0, 8)}, '发送工作流状态快照失败')
        }
    }
    log.info({
        sessionId: sessionId?.slice(0, 8),
        source: params.source || 'desktop',
        clients: s.clients.size
    }, 'WS 已连接')

    ws.on('message', (raw) => {
        void (async () => {
        let msg;
        try {
            msg = JSON.parse(raw.toString())
        } catch {
            return
        }
        if (msg.type === 'stop_generation') {
            await taskCommands.cancelTask(sessionId, {source: ws._source, userId: ws._adapterUserId || null})
            return
        }
        if (msg.type === 'preference_response') {
            if (IM_SOURCES.has(ws._source)) return
            try {
                const result = userPreferences.respond({
                    projectDir: s.workDir,
                    suggestionId: msg.suggestionId,
                    action: msg.action,
                })
                broadcastDesktop(sessionId, {type: 'preference_suggestion_resolved', ...result})
            } catch (error) {
                ws.send(JSON.stringify({
                    type: 'preference_error',
                    suggestionId: msg.suggestionId,
                    code: error.code || 'PREFERENCE_RESPONSE_FAILED',
                    message: '偏好保存失败，请稍后重试',
                }))
            }
            return
        }
        // 即时权限切换: 更新 session 并自动通过所有 pending 权限请求
        if (msg.type === 'setting_change') {
            if (IM_SOURCES.has(ws._source)) return
            const newPerm = msg.permissionMode
            if (!VALID_PERMISSION_MODES.has(newPerm)) {
                ws.send(JSON.stringify({type: 'setting_rejected', code: 'invalid_permission_mode'}))
                return
            }
            if (newPerm && newPerm !== s.permissionMode) {
                s.permissionMode = newPerm
                updateTaskState(s, sessionId, {...(s.taskState || {}), permissionMode: newPerm})
                persistSessionCatalogSettings(s, sessionId, {permissionMode: newPerm})
                log.info({sessionId: sessionId?.slice(0,8), permissionMode: newPerm}, 'permissionMode 变更 (即时)')
                if (newPerm === 'bypassPermissions' && s.pending) {
                    for (const [rid, entry] of s.pending) {
                        if (entry.type === 'permission') {
                            settlePending(sessionId, rid, {behavior: 'allow', updatedInput: entry.input}, 'auto')
                        }
                    }
                }
            }
            return
        }
        // 桌面端权限/方案选择响应
        if (msg.type === 'permission_response' && msg.requestId) {
            const entry = s.pending?.get(msg.requestId)
            if (entry) settlePending(sessionId, msg.requestId, decisionToResult(entry, msg.decision), 'desktop')
            return
        }
        if (msg.type === 'choice_response' && msg.requestId) {
            const entry = s.pending?.get(msg.requestId)
            if (entry) settlePending(sessionId, msg.requestId, decisionToResult(entry, null, msg.optionIndex, msg.questionIndex, msg.customText), 'desktop')
            return
        }
        if (msg.type === 'user_message') {
            const result = await taskCommands.submitTask({
                sessionId,
                source: ws._source,
                userId: ws._adapterUserId || null,
                messageId: msg.messageId,
                content: msg.content,
                taskText: msg.taskText,
                permissionMode: msg.permissionMode,
                thinkingLevel: msg.thinkingLevel,
                modelMode: msg.modelMode,
                model: msg.model,
                modelMeta: msg.modelMeta,
                hasAttachments: msg.hasAttachments,
                noWorkflow: msg._noWorkflow,
            })
            if (ws.readyState === 1) ws.send(JSON.stringify(result))
        }
        })().catch(error => {
            log.error({err: error, sessionId: sessionId?.slice(0, 8), source: ws._source}, 'WebSocket 消息处理异常')
            if (ws.readyState === 1) {
                try {
                    ws.send(JSON.stringify({type: 'error', code: 'message_handler_failed', message: '消息处理失败，请稍后重试'}))
                } catch (sendError) {
                    log.debug({err: sendError, sessionId: sessionId?.slice(0, 8)}, 'WebSocket 错误响应发送失败')
                }
            }
        })
    })

    // 注册 pong 处理器更新心跳时间戳（仅 session 连接）
    ws._lastPong = Date.now()
    ws.on('pong', () => { ws._lastPong = Date.now() })

    ws.on('close', () => {
        s.clients.delete(ws);
        if (s.clients.size === 0 && focusedSessionId === sessionId) focusedSessionId = null
    })
})

// ---- Start ----
let shuttingDown = false
async function shutdownGateway(reason, exitCode = 0) {
    if (shuttingDown) return
    shuttingDown = true
    log.info({reason}, 'Gateway 开始关闭')
    const closers = []
    for (const platform of ADAPTER_PLATFORMS) stopAdapter(platform)
    for (const taskId of [...cronJobs.keys()]) destroyScheduledJob(taskId)
    for (const taskId of [...scheduledRuns.keys()]) finishScheduledRun(taskId)
    clearInterval(wsPingTimer)
    for (const ws of wss.clients) {
        try { ws.close(1001, 'gateway shutting down') } catch (error) {
            log.debug({err: error}, '关闭 WebSocket 失败')
        }
    }
    for (const [sessionId, session] of sessions) {
        finishImProgressReporters(sessionId)
        for (const requestId of [...(session.pending?.keys() || [])]) {
            settlePending(sessionId, requestId, {behavior: 'deny', message: 'Gateway 正在关闭', interrupt: true}, 'shutdown')
        }
        try { session.pushStream?.close() } catch (error) {
            log.debug({err: error, sessionId: sessionId?.slice(0, 8)}, '关闭 Session 输入流失败')
        }
        try {
            const closing = session.query?.return?.()
            if (closing && typeof closing.then === 'function') closers.push(closing)
        } catch (error) {
            log.debug({err: error, sessionId: sessionId?.slice(0, 8)}, '关闭 Session query 失败')
        }
        appendSessionEvent(session, 'runtime/shutdown', {reason: String(reason || 'shutdown').slice(0, 120)})
        session.eventJournal?.close()
    }
    taskCommands.dispose()
    closers.push(providerRegistry.disposeAll().catch(error => {
        log.warn({err: error}, 'Agent Provider Registry 关闭不完整')
    }))
    try {
        const closing = stopDeepSeekProxy()
        if (closing && typeof closing.then === 'function') closers.push(closing)
    } catch (error) {
        log.debug({err: error}, '关闭 DeepSeek proxy 失败')
    }
    try { stopOpenCodeProxy() } catch (error) { log.debug({err: error}, '关闭 OpenCode proxy 失败') }
    try {
        const closing = stopCodexRelayProxy()
        if (closing && typeof closing.then === 'function') closers.push(closing)
    } catch (error) { log.debug({err: error}, '关闭 Codex Relay proxy 失败') }
    try { bridgeStateDb?.close() } catch (error) { log.warn({err: error}, '关闭 SQLite 状态库失败') }
    const serverClosed = new Promise(resolve => {
        if (!httpServer.listening) { resolve(); return }
        httpServer.close(() => resolve())
    })
    await Promise.race([
        Promise.allSettled([...closers, serverClosed]),
        new Promise(resolve => setTimeout(resolve, 2200)),
    ])
    log.info({reason}, 'Gateway 已关闭')
    process.exit(exitCode)
}

function requestGatewayShutdown(reason, exitCode = 0) {
    shutdownGateway(reason, exitCode).catch(error => {
        log.fatal({err: error, reason}, 'Gateway 关闭失败')
        process.exit(exitCode || 1)
    })
}

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

async function initializeSecurePayloadKey() {
    const environmentKey = process.env.BRIDGE_SECURE_PAYLOAD_KEY
    if (environmentKey) {
        try {
            configureSecurePayloadMasterKey(environmentKey)
            delete process.env.BRIDGE_SECURE_PAYLOAD_KEY
            return true
        } catch (error) {
            delete process.env.BRIDGE_SECURE_PAYLOAD_KEY
            log.error({err: error}, '环境变量中的安全存储密钥无效')
            return false
        }
    }
    if (typeof process.send !== 'function') return false
    return new Promise(resolve => {
        let settled = false
        const finish = configured => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            process.off('message', onMessage)
            resolve(configured)
        }
        const onMessage = message => {
            if (message?.type !== 'bridge:init') return
            try {
                configureSecurePayloadMasterKey(message.securePayloadKey)
                finish(true)
            } catch (error) {
                log.error({err: error}, 'Electron 注入的安全存储密钥无效')
                finish(false)
            }
        }
        const timer = setTimeout(() => finish(false), 5000)
        timer.unref?.()
        process.on('message', onMessage)
        process.send({type: 'bridge:init-request'})
    })
}

async function bootGateway() {
    const migration = prepareBridgeHome({bridgeHome: BRIDGE_HOME})
    log.info({
        bridgeHome: BRIDGE_HOME,
        migrated: migration.copied?.length || 0,
        skipped: migration.skipped?.length || 0,
        alreadyComplete: migration.alreadyComplete,
    }, 'Bridge 私有配置目录已准备')
    bridgeStateDb = createBridgeStateDb({bridgeHome: BRIDGE_HOME, logger: log})
    if (bridgeStateDb.degraded) {
        log.warn({
            path: bridgeStateDb.path,
            code: bridgeStateDb.error?.code || 'STATE_STORE_UNAVAILABLE',
            degradedReason: bridgeStateDb.degradedReason,
            quarantinePaths: bridgeStateDb.quarantinePaths,
        }, 'SQLite 状态库不可用，将使用旧文件持久化')
    } else {
        log.info({path: bridgeStateDb.path, driver: bridgeStateDb.driver, schemaVersion: bridgeStateDb.schemaVersion}, 'SQLite 状态库已启用')
        try {
            const tasks = bridgeStateDb.pruneTaskState({olderThanMs: 30 * 24 * 60 * 60 * 1000, maxRows: 500})
            const workflows = bridgeStateDb.pruneWorkflowState({olderThanMs: 30 * 24 * 60 * 60 * 1000, maxRows: 500})
            if (tasks || workflows) log.info({tasks, workflows}, '已清理过期 SQLite 运行状态投影')
        } catch (error) {
            log.warn({err: error}, 'SQLite 运行状态投影清理失败，本次启动继续保留旧记录')
        }
    }
    memoryService = createMemoryService({bridgeHome: BRIDGE_HOME, stateStore: bridgeStateDb, logger: log})
    const injected = await initializeSecurePayloadKey()
    if (typeof process.send === 'function' && !injected) {
        log.warn('未收到 Electron 安全存储密钥，将使用受限权限本地密钥')
    }
    try {
        migrateAdapterCredentials()
    } catch (error) {
        adapterConfigReadError = String(error?.message || error)
        log.error({err: error}, 'IM 凭据加密迁移失败，适配器将保持停止')
    }
    // Hook 启动检查只读，不修改 Bridge 私有配置。
    validateHooks()
    httpServer.on('error', error => {
        log.fatal({err: error, port: PORT}, 'Gateway 监听失败')
        requestGatewayShutdown('listen_error', 1)
    })
    httpServer.listen(PORT, '127.0.0.1', () => {
        try {
            persistBridgeToken()
        } catch (error) {
            log.fatal({err: error, path: BRIDGE_TOKEN_PATH}, 'Gateway token 写入失败，无法安全启动')
            requestGatewayShutdown('token_persist_failed', 1)
            return
        }
        for (const platform of ADAPTER_PLATFORMS) startAdapter(platform)
        log.info({port: PORT}, `Gateway 已启动`)
        // 版本检查在端口绑定成功后执行，避免启动失败时仍产生外部网络请求。
        checkCavemanUpdate().catch(e => log.warn({err: e}, 'Caveman 版本检查异常'))
        checkRtkUpdate().catch(e => log.warn({err: e}, 'RTK 版本检查异常'))
        resumeScheduledTasks()
        cleanupOrphanSessionDirs()
        startDeepSeekProxy('https://api.deepseek.com/anthropic').catch(e => log.warn({err: e}, 'proxy boot 启动失败'))
        startOpenCodeProxy().catch(e => log.warn({err: e}, 'opencode proxy boot 启动失败'))
    })
}

bootGateway().catch(error => {
    log.fatal({err: error}, 'Gateway 启动失败')
    requestGatewayShutdown('boot_failed', 1)
})

// 只读文件头 N 字节，按行切分，丢弃可能截断的最后一行
function readFileHeadLines(path, maxBytes = 4096) {
    const fd = openSync(path, 'r');
    try {
        const buf = Buffer.alloc(maxBytes);
        const n = readSync(fd, buf, 0, maxBytes, 0);
        const text = buf.toString('utf8', 0, n);
        const lastNL = text.lastIndexOf('\n');
        return (lastNL >= 0 ? text.slice(0, lastNL) : text).split('\n');
    } finally {
        closeSync(fd);
    }
}

// 启动时清理幽灵目录: {sessionId}/subagents/ 无对应主 .jsonl 的孤儿残留
// 来源: SDK Task tool 子 agent transcript 在主 session 被删除后残留 / Gateway 崩溃未完成清理
function cleanupOrphanSessionDirs() {
    const projectsDir = join(BRIDGE_HOME, 'projects')
    let cleaned = 0
    try {
        for (const projectEntry of readdirSync(projectsDir)) {
            const projectDir = join(projectsDir, projectEntry)
            try {
                if (!statSync(projectDir).isDirectory()) continue
                for (const entry of readdirSync(projectDir)) {
                    if (entry.endsWith('.jsonl') || entry.startsWith('.trash-') || entry === 'bridge-session-map.json'
                        || entry === 'bridge-session-visibility.json'
                        || entry === 'bridge-snapshot' || entry === 'bridge-checkpoints' || entry === 'bridge-task-state'
                        || entry === 'bridge-session-events'
                        || entry === 'bridge-deleted-sessions.json' || entry === 'bridge-scheduled-tasks.json'
                        || entry === 'bridge-workflow-history.jsonl' || entry === 'bridge-config.json') continue
                    const entryPath = join(projectDir, entry)
                    try {
                        if (!statSync(entryPath).isDirectory()) continue
                        const subagentsDir = join(entryPath, 'subagents')
                        const mainJsonl = join(projectDir, entry + '.jsonl')
                        if (existsSync(subagentsDir) && !existsSync(mainJsonl)) {
                            rmSync(entryPath, {recursive: true, force: true})
                            // 同时清理可能的 .trash- 残余
                            const trashJsonl = join(projectDir, '.trash-' + entry + '.jsonl')
                            try {
                                if (existsSync(trashJsonl)) unlinkSync(trashJsonl)
                            } catch (error) {
                                log.debug({err: error, path: trashJsonl}, '清理幽灵 Session trash 文件失败')
                            }
                            cleaned++
                        }
                    } catch (error) {
                        log.debug({err: error, path: entryPath}, '检查幽灵 Session 目录失败')
                    }
                }
            } catch (error) {
                log.debug({err: error, projectDir}, '扫描项目 Session 目录失败')
            }
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') log.warn({err: error, projectsDir}, '启动时扫描幽灵 Session 失败')
    }
    if (cleaned > 0) log.info({cleaned}, '启动时清理幽灵 session 目录')
}

// ---- Project scanning (hand-rolled) ----
let _projectsCache = null, _projectsCacheTs = 0
const PROJECTS_CACHE_TTL = 10_000  // 10s 内复用缓存，避免每次 /p 命令触发全量扫描
// 互斥锁: 并发调用共享同一个扫描 Promise，避免重复 IO
let _scanningProjects = null
// 已删除会话 ID → 过期时间戳，scanProjects 返回结果时过滤，防御三重竞态：
// 1) deleteSessionFiles rename 后 SDK 进程残留重建了 JSONL
// 2) 扫描与 DELETE 并发：扫描完成写回缓存时 DELETE 还未执行到 invalidate
// 3) 缓存命中：返回缓存结果时其中包含已删除的会话（缓存 10s 内的旧快照）
// 持久化到 bridge-deleted-sessions.json，Gateway 重启不丢失删除标记
const DELETED_SESSIONS_FILE = join(BRIDGE_HOME, 'bridge-deleted-sessions.json')
const _deletedSessionIds = new Map()

// 启动时从磁盘恢复删除标记
try {
    const saved = readJSON(DELETED_SESSIONS_FILE)
    if (Array.isArray(saved)) {
        const now = Date.now()
        for (const [sid, expiresAt] of saved) {
            if (expiresAt > now) _deletedSessionIds.set(sid, expiresAt)
        }
    }
} catch (error) {
    log.warn({err: error, path: DELETED_SESSIONS_FILE}, '恢复已删除 Session 标记失败')
}

let _deletedDirty = false
let _deletedPersistScheduled = false
let _deletedPersistRetryCount = 0
function _schedulePersistDeleted() {
    _deletedDirty = true
    if (!_deletedPersistScheduled) {
        _deletedPersistScheduled = true
        setImmediate(() => {
            _deletedPersistScheduled = false
            if (_deletedDirty) {
                _deletedDirty = false
                try {
                    writeFileSync(DELETED_SESSIONS_FILE, JSON.stringify([..._deletedSessionIds], null, 2))
                    _deletedPersistRetryCount = 0
                } catch (error) {
                    _deletedDirty = true
                    _deletedPersistRetryCount++
                    log.warn({err: error, path: DELETED_SESSIONS_FILE}, '保存已删除 Session 标记失败')
                    const retryDelay = Math.min(30_000, 1000 * 2 ** Math.min(_deletedPersistRetryCount - 1, 5))
                    const retryTimer = setTimeout(() => _schedulePersistDeleted(), retryDelay)
                    retryTimer.unref?.()
                }
            }
        })
    }
}

function markSessionDeleted(sessionId) {
    _deletedSessionIds.set(sessionId, Date.now() + 1_800_000)  // 30 分钟窗口，Windows 下 SDK 进程退出可能滞后远超 10 分钟
    if (_deletedSessionIds.size > 500) {  // 惰性清理，防内存泄漏
        const now = Date.now()
        for (const [k, v] of _deletedSessionIds) { if (v < now) _deletedSessionIds.delete(k) }
    }
    _schedulePersistDeleted()
}

function filterDeletedSessions(projects) {
    let dirty = false
    const now = Date.now()
    for (const [k, v] of _deletedSessionIds) { if (v < now) { _deletedSessionIds.delete(k); dirty = true } }
    if (dirty) _schedulePersistDeleted()
    if (_deletedSessionIds.size === 0 && !dirty) return projects
    for (const p of projects) {
        const removedIds = p.sessions.filter(session => _deletedSessionIds.has(session.id)).map(session => session.id)
        if (removedIds.length > 0) {
            p.sessions = p.sessions.filter(session => !_deletedSessionIds.has(session.id))
            p.sessionCount = p.sessions.length
        }
    }
    return projects.filter(p => p.sessionCount > 0)
}

async function scanProjects() {
    const now = Date.now()
    if (_projectsCache && (now - _projectsCacheTs) < PROJECTS_CACHE_TTL) return filterDeletedSessions(_projectsCache)
    if (_scanningProjects) return _scanningProjects.then(filterDeletedSessions)
    _scanningProjects = (async () => {

    const base = join(BRIDGE_HOME, 'projects');
    const results = []
    try {
        for (const group of collectTranscriptProjectGroups(base)) {
            try {
                const {workDir: wd, projectKey, projectDirs} = group
                const visibility = loadProjectVisibilityWithMigration(projectDirs, wd)
                const catalogRows = reconcileSessionCatalog({
                    projectKey,
                    projectDirs,
                    workDir: wd,
                    visibility,
                    stateStore: bridgeStateDb,
                    readHeadLines: readFileHeadLines,
                    settingsForSession: sessionId => ({
                        permissionMode: loadTaskState(wd, sessionId)?.permissionMode || null,
                        mirrors: getPersistedMirrors(readJSON(sessionMirrorStorePath(wd)), [sessionId]),
                    }),
                }).filter(row => !_deletedSessionIds.has(row.id))
                if (!catalogRows.length) continue
                results.push({
                    workDir: wd,
                    encodedDir: projectKey,
                    sessionCount: catalogRows.length,
                    sessions: catalogRows.map(row => ({id: row.id, title: row.title, size: row.size, encodedDir: projectKey})),
                    lastActive: Math.max(...catalogRows.map(row => Number(row.mtime || 0)), 0),
                })
            } catch (error) {
                log.warn({err: error, workDir: group.workDir, projectKey: group.projectKey}, '项目会话目录协调失败，已跳过当前项目')
            }
        }
    } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        ;results.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
        const filtered = filterDeletedSessions(results)
        _projectsCache = filtered; _projectsCacheTs = Date.now()
        return filtered
    })().finally(() => { _scanningProjects = null })
    return _scanningProjects
}
/**
 * 删除会话对应的 .jsonl 文件。
 * Windows 下 Claude CLI 子进程退出可能滞后于 query.return()，文件句柄未释放
 * 导致 unlinkSync 报 EBUSY。策略：先重试 unlinkSync（指数退避），仍失败则 rename
 * 为 .trash- 前缀让 scanProjects 自动跳过，后台残留进程最终退出后文件自然清理。
 */
async function removeSessionArtifact(path, {recursive = false} = {}) {
    const retryDelays = [0, 100, 300, 1000, 3000]
    let lastError = null
    for (const delayMs of retryDelays) {
        if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
        try {
            rmSync(path, {recursive, force: true})
            return
        } catch (error) {
            if (error?.code === 'ENOENT') return
            lastError = error
        }
    }
    if (!existsSync(path)) return
    const trashPath = join(dirname(path), `.trash-${Date.now()}-${basename(path)}`)
    try {
        renameSync(path, trashPath)
    } catch (error) {
        throw lastError || error
    }
}

async function deleteSessionFiles(sessionId, relatedSessionIds = []) {
    const projectsDir = join(BRIDGE_HOME, 'projects')
    let entries
    try {
        entries = readdirSync(projectsDir)
    } catch (error) {
        if (error?.code === 'ENOENT') return
        throw error
    }

    const targetIds = new Set([sessionId, ...relatedSessionIds].filter(Boolean))
    const projects = []
    for (const entry of entries) {
        const workDir = decodeProjectName(entry)
        if (!workDir) continue
        const sdkDir = join(projectsDir, entry)
        const map = loadSessionMap(workDir)
        projects.push({workDir, sdkDir, map})
        let expanded = true
        while (expanded) {
            expanded = false
            for (const [key, value] of Object.entries(map)) {
                const gatewayId = key.startsWith('@rev:') ? value : key
                const sdkId = key.startsWith('@rev:') ? key.slice(5) : value
                if (!targetIds.has(gatewayId) && !targetIds.has(sdkId)) continue
                if (gatewayId && !targetIds.has(gatewayId)) { targetIds.add(gatewayId); expanded = true }
                if (sdkId && !targetIds.has(sdkId)) { targetIds.add(sdkId); expanded = true }
            }
        }
    }

    const failures = []
    for (const {sdkDir} of projects) {
        for (const targetId of targetIds) {
            const transcriptPath = join(sdkDir, targetId + '.jsonl')
            const sessionDir = join(sdkDir, targetId)
            if (!existsSync(transcriptPath) && !existsSync(sessionDir)) continue
            try {
                await deleteSession(targetId, {dir: sdkDir})
            } catch (error) {
                log.debug({err: error, sessionId: targetId?.slice(0, 8), sdkDir}, 'SDK 删除 Session 文件失败，执行本地兜底清理')
            }
            for (const [path, recursive] of [[transcriptPath, false], [sessionDir, true]]) {
                if (!existsSync(path)) continue
                try {
                    await removeSessionArtifact(path, {recursive})
                } catch (error) {
                    failures.push(error)
                    log.warn({err: error, sessionId: targetId?.slice(0, 8), path}, '清理 Session 残留失败')
                }
            }
            bridgeStateDb?.removeSessionIndex?.(transcriptPath)
        }
    }

    for (const {workDir, sdkDir, map} of projects) {
        let dirty = false
        for (const [key, value] of Object.entries(map)) {
            const sdkId = key.startsWith('@rev:') ? key.slice(5) : value
            if (!targetIds.has(key) && !targetIds.has(value) && !targetIds.has(sdkId)) continue
            delete map[key]
            dirty = true
        }
        if (dirty) {
            if (!saveSessionMap(workDir, map)) {
                const error = new Error(`保存清理后的 Session 映射失败: ${workDir}`)
                failures.push(error)
                log.warn({err: error, workDir}, '保存清理后的 Session 映射失败')
            }
        }
        const visibility = getProjectVisibility(workDir)
        let nextVisibility = visibility
        for (const targetId of targetIds) {
            nextVisibility = removeSessionVisibility(nextVisibility, {gatewaySessionId: targetId, sdkSessionId: targetId})
        }
        if (JSON.stringify(nextVisibility) !== JSON.stringify(visibility)
            && !saveSessionVisibility(workDir, nextVisibility)) {
            const error = new Error(`保存清理后的 Session 可见性失败: ${workDir}`)
            failures.push(error)
            log.warn({err: error, workDir}, '保存清理后的 Session 可见性失败')
        }

        for (const targetId of targetIds) {
            const artifacts = [
                join(sdkDir, 'bridge-snapshot', targetId + '.json'),
                join(sdkDir, 'bridge-checkpoints', targetId + '.json'),
                join(sdkDir, 'bridge-task-state', targetId + '.json'),
                join(sdkDir, 'bridge-session-events', targetId + '.jsonl'),
            ]
            for (const artifact of artifacts) {
                if (!existsSync(artifact)) continue
                try {
                    await removeSessionArtifact(artifact)
                } catch (error) {
                    failures.push(error)
                    log.warn({err: error, sessionId: targetId?.slice(0, 8), path: artifact}, '清理 Session 元数据失败')
                }
            }
        }
        if (!removePersistedSessionMirrors(workDir, targetIds)) {
            failures.push(new Error(`清理 Session 镜像状态失败: ${workDir}`))
        }
    }

    if (failures.length > 0) {
        throw new AggregateError(failures, `清理 Session 文件失败: ${failures.length} 项`)
    }
}
function invalidateProjectsCache() { _projectsCache = null }

// 通过内容检测判断 transcript 是否为 SDK subagent。只有明确的 sidechain 标记才允许过滤。
function isAgentTranscriptByContent(filePath) {
    return classifyTranscriptFile(filePath) === 'agent'
}

function resolveTranscriptProjectWorkDir(projectDir, encodedDir) {
    try {
        const files = readdirSync(projectDir).filter(name => name.endsWith('.jsonl') && !name.startsWith('.trash-'))
        for (const file of files) {
            for (const line of readFileHeadLines(join(projectDir, file), 4096)) {
                try {
                    const record = JSON.parse(line)
                    if (typeof record?.cwd === 'string' && record.cwd.trim()) return normalizeWorkDir(record.cwd)
                } catch (error) {
                    if (!(error instanceof SyntaxError)) throw error
                }
            }
        }
    } catch (error) {
        log.debug({err: error, projectDir}, '读取 transcript 项目目录失败')
    }
    return decodeProjectName(encodedDir) || encodedDir
}

function collectTranscriptProjectGroups(projectsRoot = join(BRIDGE_HOME, 'projects')) {
    const groups = new Map()
    try {
        for (const entry of readdirSync(projectsRoot, {withFileTypes: true})) {
            if (!entry.isDirectory()) continue
            const projectDir = join(projectsRoot, entry.name)
            let hasTranscript = false
            try {
                hasTranscript = readdirSync(projectDir).some(name => name.endsWith('.jsonl') && !name.startsWith('.trash-'))
            } catch {
                continue
            }
            if (!hasTranscript) continue
            const workDir = resolveTranscriptProjectWorkDir(projectDir, entry.name)
            const normalized = normalizeWorkDir(workDir)
            if (!normalized) continue
            const identity = normalized.toLowerCase()
            const group = groups.get(identity) || {workDir: normalized, projectKey: encodeProjectName(normalized), projectDirs: []}
            group.projectDirs.push(projectDir)
            groups.set(identity, group)
        }
        for (const group of groups.values()) {
            const canonicalDir = join(projectsRoot, group.projectKey)
            if (existsSync(canonicalDir) && !group.projectDirs.includes(canonicalDir)) group.projectDirs.unshift(canonicalDir)
        }
    } catch (error) {
        log.debug({err: error, projectsRoot}, '扫描 transcript 项目分组失败')
    }
    return [...groups.values()]
}

function loadProjectVisibilityWithMigration(projectDirs, workDir) {
    const directories = [...new Set((Array.isArray(projectDirs) ? projectDirs : [projectDirs]).filter(Boolean))]
    const canonicalDir = dirname(sessionVisibilityStorePath(workDir))
    let state = loadSessionVisibility(canonicalDir)
    for (const projectDir of directories) {
        if (projectDir === canonicalDir) continue
        const legacy = loadSessionVisibility(projectDir)
        for (const [gatewaySessionId, entry] of Object.entries(legacy.sessions || {})) {
            state = markSessionVisible(state, {gatewaySessionId, ...entry})
        }
    }
    if (state.legacyMigrationVersion >= 2) return state

    const sessionMap = {}
    for (const projectDir of [...directories, canonicalDir]) Object.assign(sessionMap, readJSON(join(projectDir, 'bridge-session-map.json')) || {})
    const transcriptKinds = {}
    const taskStates = {}
    for (const [gatewaySessionId, sdkSessionId] of Object.entries(sessionMap)) {
        if (gatewaySessionId.startsWith('@rev:') || typeof sdkSessionId !== 'string') continue
        const transcriptPath = [...directories, canonicalDir].map(projectDir => join(projectDir, `${sdkSessionId}.jsonl`))
            .find(path => existsSync(path))
        if (transcriptPath) transcriptKinds[sdkSessionId] = classifyTranscriptFile(transcriptPath)
        taskStates[gatewaySessionId] = readJSON(join(canonicalDir, 'bridge-task-state', `${gatewaySessionId}.json`))
        taskStates[sdkSessionId] = readJSON(join(canonicalDir, 'bridge-task-state', `${sdkSessionId}.json`))
    }
    let migrated = migrateLegacySessionVisibility(state, {sessionMap, transcriptKinds, taskStates})
    const scheduledIds = new Set(Object.values(scheduledTasks || {}).map(task => String(task?.sessionId || '').trim()).filter(Boolean))
    const internalSdkIds = new Set(Object.entries(sessionMap)
        .filter(([gatewaySessionId]) => gatewaySessionId.startsWith('@rev:') || /^(?:agent-|wf-agent-)/.test(gatewaySessionId) || scheduledIds.has(gatewaySessionId))
        .map(([, sdkSessionId]) => sdkSessionId))
    for (const projectDir of directories) {
        let filenames = []
        try {
            filenames = readdirSync(projectDir).filter(name => name.endsWith('.jsonl') && !name.startsWith('.trash-'))
        } catch {
            continue
        }
        for (const filename of filenames) {
            const sdkSessionId = filename.slice(0, -'.jsonl'.length)
            if (shouldShowSession(migrated, sdkSessionId) || scheduledIds.has(sdkSessionId) || internalSdkIds.has(sdkSessionId)) continue
            if (classifyTranscriptFile(join(projectDir, filename)) !== 'main') continue
            // 旧版本未保存来源时信息不可逆；仅明确的主 transcript 可按桌面输入会话修复。
            migrated = markSessionVisible(migrated, {gatewaySessionId: sdkSessionId, sdkSessionId, source: 'desktop', firstInputAt: 0})
        }
    }
    migrated = {...migrated, legacyMigrationVersion: 2}
    saveSessionVisibility(workDir, migrated)
    return migrated
}

async function listProjectSessions(ed) {
    const projectsRoot = join(BRIDGE_HOME, 'projects')
    const group = collectTranscriptProjectGroups(projectsRoot)
        .find(item => item.projectKey === ed || item.projectDirs.some(path => basename(path) === ed))
    if (!group) return []
    const visibility = loadProjectVisibilityWithMigration(group.projectDirs, group.workDir)
    return reconcileSessionCatalog({
        projectKey: group.projectKey,
        projectDirs: group.projectDirs,
        workDir: group.workDir,
        visibility,
        stateStore: bridgeStateDb,
        readHeadLines: readFileHeadLines,
        settingsForSession: sessionId => ({
            permissionMode: loadTaskState(group.workDir, sessionId)?.permissionMode || null,
            mirrors: getPersistedMirrors(readJSON(sessionMirrorStorePath(group.workDir)), [sessionId]),
        }),
    }).filter(row => !_deletedSessionIds.has(row.id)).map(row => ({
        id: row.id,
        title: row.title,
        size: row.size,
        mtime: row.mtime,
        encodedDir: group.projectKey,
    }))
}

async function getLastModified(dir, files) {
    let l = 0;
    for (const f of files) {
        try {
            const s = statSync(join(dir, f));
            if (s.mtimeMs > l) l = s.mtimeMs
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
    }
    ;
    return l
}

// ════════════════════════ 文件快照 Diff ════════════════════════

// 按扩展名判断是否二进制文件（不做内容 diff）
function isBinaryPath(p) {
    const dot = p.lastIndexOf('.')
    if (dot < 0) return false
    return BINARY_EXTS.has(p.slice(dot).toLowerCase())
}

// 安全解析：把相对路径拼到 workDir 下，拒绝越权（.. / 绝对路径）
// 返回绝对路径；非法返回 null
function resolveSafe(workDir, relPath) {
    return safeChildPath(workDir, relPath, {allowNested: true})
}

// 栈式递归扫描工作目录，跳过排除目录。返回扁平相对路径列表。
// SIDE_EFFECT: 无（只读文件系统）
// ── scanWorkdirFiles — 扫描工作目录文件列表 ──
// 功能说明: 深度遍历工作目录，排除 node_modules/.git 等目录和二进制文件，生成路径列表
// 实现方式: 栈迭代 BFS（非递归，避免深层目录栈溢出），每个文件记录 rel 路径 + 大小 + 是否二进制
//   超过 MAX_SNAP_FILES (5000) 时标记 truncated=true 并中断
// 关键数据流: workDir → stack BFS 遍历 → [{path, size, binary}] → {files, truncated, missing}
function scanWorkdirFiles(workDir) {
    const files = []
    let truncated = false
    if (!existsSync(workDir)) return {files, truncated, missing: true}
    const stack = [workDir]
    while (stack.length) {
        if (files.length >= MAX_SNAP_FILES) {
            truncated = true;
            break
        }
        const dir = stack.pop()
        let entries
        try {
            entries = readdirSync(dir, {withFileTypes: true})
        } catch {
            continue
        }
        for (const ent of entries) {
            const full = join(dir, ent.name)
            if (ent.isDirectory()) {
                if (SNAP_EXCLUDE_DIRS.has(ent.name)) continue
                stack.push(full)
            } else if (ent.isFile()) {
                if (files.length >= MAX_SNAP_FILES) {
                    truncated = true;
                    break
                }
                let size = 0
                let mtimeMs = 0
                try {
                    const s = statSync(full)
                    size = s.size
                    mtimeMs = s.mtimeMs
                } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
                // relative() 规范化两边，兼容 workDir 里的 // 双斜杠
                const rel = relative(workDir, full).replace(/\\/g, '/')
                files.push({path: rel, size, mtimeMs, binary: isBinaryPath(rel)})
            }
        }
    }
    return {files, truncated, missing: false}
}

// ── getGitHead — 获取当前 HEAD 的 branch/hash/shortHash ──
function getGitHead(workDir) {
    try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: workDir, encoding: 'utf8', timeout: 3000,
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim()
        const hash = execSync('git rev-parse HEAD', {
            cwd: workDir, encoding: 'utf8', timeout: 3000,
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim()
        return {branch, hash, shortHash: hash.slice(0, 7)}
    } catch { return null }
}

// ── scanGitFiles — git ls-files 获取文件列表，自动遵从 .gitignore ──
// 返回格式与 scanWorkdirFiles 完全一致，失败返回 null
function scanGitFiles(workDir) {
    try {
        const out = execSync(
            'git ls-files --cached --others --exclude-standard --full-name -z',
            {cwd: workDir, encoding: 'utf8', timeout: 10000,
             maxBuffer: 10 * 1024 * 1024,
             stdio: ['pipe', 'pipe', 'pipe']}
        )
        const files = []
        for (const raw of out.split('\0')) {
            if (files.length >= MAX_SNAP_FILES) break
            const path = raw.trim()
            if (!path) continue
            const topDir = path.split('/')[0]
            if (SNAP_EXCLUDE_DIRS.has(topDir)) continue
            try {
                const s = statSync(join(workDir, path))
                if (!s.isFile()) continue
                files.push({path: path.replace(/\\/g, '/'), size: s.size,
                            mtimeMs: s.mtimeMs, binary: isBinaryPath(path)})
            } catch { /* 已删除文件跳过 */ }
        }
        return {files, truncated: files.length >= MAX_SNAP_FILES, missing: false}
    } catch { return null }
}

// ── buildGitSnapshot — git 仓库文件快照（内容走磁盘读，避免 CRLF/LF 误判）──
// 与 buildFileSnapshot 的区别：文件列表来自 git ls-files（尊重 .gitignore），
// 返回值多 gitHead 字段。内容读取完全一致（readFileSync）。
// 任一步 git 命令失败 → 返回 null，由 buildFileSnapshot 回退磁盘扫描
function buildGitSnapshot(workDir, baseline) {
    const gitHead = getGitHead(workDir)
    if (!gitHead) return null
    const scan = scanGitFiles(workDir)
    if (!scan) return null

    const map = new Map()
    const baseFiles = baseline?.files
    for (const f of scan.files) {
        if (f.binary) { map.set(f.path, {binary: true, size: f.size}); continue }
        if (f.size > MAX_SNAP_FILE_BYTES) { map.set(f.path, {binary: false, tooLarge: true, size: f.size}); continue }

        const prev = baseFiles?.get(f.path)
        if (prev && !prev.readError && !prev.tooLarge
            && prev.size === f.size && prev.mtimeMs === f.mtimeMs
            && typeof prev.content === 'string') {
            map.set(f.path, prev); continue
        }
        try {
            const content = readFileSync(join(workDir, f.path), 'utf8')
            map.set(f.path, {binary: false, content, size: f.size, mtimeMs: f.mtimeMs,
                lines: content.length ? content.split('\n').length : 0})
        } catch {
            map.set(f.path, {binary: false, readError: true, size: f.size, mtimeMs: f.mtimeMs})
        }
    }
    return {takenAt: Date.now(), files: map, truncated: scan.truncated, gitHead}
}

// ── buildFileSnapshot — 工作目录文件快照构建（支持增量优化）──
// 功能说明: 为工作目录创建完整文件内容快照，用作每个 session 的 diff 基线
//   文本文件存储完整内容 + sha256 hash；二进制文件仅存元信息(size, lastModified)；超大文件跳过内容
// 实现方式: scanWorkdirFiles → 逐文件读内容 → sha256 hash → 构建 {path→{content,hash,size}} Map
//   增量模式(传 baseline): baseline 有该文件且 size+mtimeMs 都未变 → 沿用 content 不重读
//   mtimeMs 缺失或 baseline 无该文件 → 重读，安全降级到全量
// SIDE_EFFECT: 无（只读文件系统）；返回对象会挂到 session.snapshot
// ── currentFileScan — 统一文件扫描入口，与 snapshot 来源对齐 ──
// snapshot 是 git 构建的就用 git ls-files，否则磁盘扫描，保证 diff 时文件列表一致
function currentFileScan(workDir, snapshot) {
    if (snapshot?.gitHead) {
        const scan = scanGitFiles(workDir)
        if (scan) return scan
    }
    return scanWorkdirFiles(workDir)
}

// 关键数据流: scanWorkdirFiles() → 读文件+hash → snapshot{files:{path,content?,hash?,size?,binary?,mtime?},fileMap{}}
function buildFileSnapshot(workDir, baseline) {
    // 尝试 git 快照（原子操作：任一步失败则回退磁盘扫描）
    const gitSnap = buildGitSnapshot(workDir, baseline)
    if (gitSnap) return gitSnap

    const {files, truncated} = scanWorkdirFiles(workDir)
    const map = new Map()
    const baseFiles = baseline?.files  // 上次快照的 Map(含 content)，未变动文件直接复用避免重读
    for (const f of files) {
        if (f.binary) {
            map.set(f.path, {binary: true, size: f.size});
            continue
        }
        if (f.size > MAX_SNAP_FILE_BYTES) {
            map.set(f.path, {binary: false, tooLarge: true, size: f.size});
            continue
        }
        // ── 增量: baseline 有且 size+mtimeMs 都未变且 content 有效 → 直接复用，跳过 readFileSync ──
        // 这是 beginTurn 每条用户消息前的性能关键路径，重读未变动文件会阻塞事件循环
        const prev = baseFiles?.get(f.path)
        if (prev && !prev.readError && !prev.tooLarge
            && prev.size === f.size
            && prev.mtimeMs === f.mtimeMs
            && typeof prev.content === 'string') {
            map.set(f.path, prev)  // 复用 baseline 对象(含 content)
            continue
        }
        try {
            const content = readFileSync(join(workDir, f.path), 'utf8')
            map.set(f.path, {
                binary: false,
                content,
                size: f.size,
                mtimeMs: f.mtimeMs,
                lines: content.length ? content.split('\n').length : 0
            })
        } catch {
            map.set(f.path, {binary: false, readError: true, size: f.size, mtimeMs: f.mtimeMs})
        }
    }
    return {takenAt: Date.now(), files: map, truncated}
}

// 滚动数组只算 LCS 长度（O(min) 空间）——给徽章算 +x/-y 用，轻量
// ── lcsLength — 最长公共子序列长度（DP 滚动数组，O(n*m) 时间，O(min(n,m)) 空间）──
// 功能说明: 计算两个字符串数组的最长公共子序列长度，用于 lineDiffStats 估算改动行数
// 实现方式: 二维 DP 压缩为两个一维滚动数组（prev + cur），每次迭代复用降低内存
//   让 b 为较短边以减少滚动数组长度
function lcsLength(a, b) {
    if (a.length === 0 || b.length === 0) return 0
    // 让 b 为较短的一边
    if (b.length > a.length) {
        const t = a;
        a = b;
        b = t
    }
    const m = b.length
    let prev = new Array(m + 1).fill(0)
    let cur = new Array(m + 1).fill(0)
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= m; j++) {
            if (a[i - 1] === b[j - 1]) cur[j] = prev[j - 1] + 1
            else cur[j] = prev[j] >= cur[j - 1] ? prev[j] : cur[j - 1]
        }
        const tmp = prev;
        prev = cur;
        cur = tmp
        cur.fill(0)
    }
    return prev[m]
}

// 用 LCS 算改动行数：added = 新行数 - 公共，removed = 旧行数 - 公共
function lineDiffStats(oldStr, newStr) {
    const a = oldStr.length ? oldStr.split('\n') : []
    const b = newStr.length ? newStr.split('\n') : []
    const lcs = lcsLength(a, b)
    return {added: b.length - lcs, removed: a.length - lcs}
}

// ── computeLineDiff — 完整行级 diff（DP + 回溯）──
// 功能说明: 计算两个文本的逐行差异，返回 type/oldNo/newNo/text 结构供 Monaco diff 渲染
//   仅点 diff 按钮时按需调用一次，不在文件列表渲染时批量触发
// 实现方式: 二维 DP (n+1)*(m+1) 计算 LCS 矩阵，再双向回溯生成 diff 行序列
//   矩阵元素超过 4M (a.length*b.length>4_000_000) 时返回 {tooLarge:true} 避免 OOM
// 关键数据流: oldStr/newStr → split('\n') → DP LCS 矩阵 → 回溯 → [{type,oldNo,newNo,text}]
function computeLineDiff(oldStr, newStr) {
    const a = oldStr.length ? oldStr.split('\n') : []
    const b = newStr.length ? newStr.split('\n') : []
    if (a.length * b.length > 4_000_000) return {tooLarge: true}
    const n = a.length, m = b.length
    // dp[i][j] = LCS(a[i:], b[j:])
    const dp = Array.from({length: n + 1}, () => new Int32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1
            else dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1]
        }
    }
    const lines = []
    let i = 0, j = 0, oldNo = 1, newNo = 1
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            lines.push({type: 'context', oldNo: oldNo++, newNo: newNo++, text: a[i]});
            i++;
            j++
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            lines.push({type: 'del', oldNo: oldNo++, newNo: null, text: a[i]});
            i++
        } else {
            lines.push({type: 'add', oldNo: null, newNo: newNo++, text: b[j]});
            j++
        }
    }
    while (i < n) {
        lines.push({type: 'del', oldNo: oldNo++, newNo: null, text: a[i]});
        i++
    }
    while (j < m) {
        lines.push({type: 'add', oldNo: null, newNo: newNo++, text: b[j]});
        j++
    }
    return {lines}
}

// ── diffSnapshotVsCurrent — 快照 vs 当前工作目录文件差异对比 ──
// 功能说明: 将 session 起始快照与当前工作目录文件对比，识别新增/修改/删除/未变四种状态
//   结果用于文件面板「仅改动」过滤 + 记录点自动生成 + 提交确认
// 实现方式:
//   1. 当前文件 > 快照文件: 先建 hash 快速查找表(snap.fileMap)
//   2. 逐当前文件比对: 无 snapshot 记录→added; hash 匹配→unchanged; hash 不同→modified
//   3. 快照中有但当前无: deleted 状态
//   4. 二进制文件用 lastModified 时间戳代替内容 hash（二进制文件读全量太贵）
//   5. modified 文件用 lineDiffStats 快速计算 added/removed 行数（仅统计，不做逐行 diff）
// 关键数据流: snapshot.fileMap{} + currentFiles[] → 逐文件 hash/lastModified 对比
//   → Map<path, {status,added,removed,binary}>
function diffSnapshotVsCurrent(snapshot, currentFiles, workDir) {
    const result = new Map()
    const snapFiles = snapshot.files
    const seen = new Set()
    for (const f of currentFiles) {
        seen.add(f.path)
        const snap = snapFiles.get(f.path)
        if (!snap) {
            // 快照里没有 → 新增
            result.set(f.path, {status: 'added', binary: f.binary, added: null, removed: 0})
            continue
        }
        if (f.binary || snap.binary) {
            // 二进制：只按 size 判断改没改
            const changed = snap.size !== f.size
            result.set(f.path, {status: changed ? 'modified' : 'unchanged', binary: true, added: null, removed: null})
            continue
        }
        if (snap.tooLarge || snap.readError) {
            // 快照没存内容，只能按 size 粗判
            const changed = snap.size !== f.size
            result.set(f.path, {status: changed ? 'modified' : 'unchanged', binary: false, added: null, removed: null})
            continue
        }
        // 文本文件：读当前内容对比
        let cur = null
        try {
            if (f.size <= MAX_SNAP_FILE_BYTES) cur = readFileSync(join(workDir, f.path), 'utf8')
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        if (cur == null) {
            const changed = snap.size !== f.size
            result.set(f.path, {status: changed ? 'modified' : 'unchanged', binary: false, added: null, removed: null})
        } else if (cur === snap.content) {
            result.set(f.path, {status: 'unchanged', binary: false, added: 0, removed: 0})
        } else {
            const st = lineDiffStats(snap.content, cur)
            result.set(f.path, {status: 'modified', binary: false, added: st.added, removed: st.removed})
        }
    }
    // 快照有、当前没有 → 删除
    for (const [path, snap] of snapFiles) {
        if (seen.has(path)) continue
        result.set(path, {status: 'deleted', binary: !!snap.binary, added: 0, removed: snap.lines ?? null})
    }
    return result
}

// ════════════════════════ 记录点（Checkpoint）持久化 + 回退 ════════════════════════
// 每轮用户消息 = 一个记录点，只存改动文件的「修改前内容」增量，落盘项目存储跨重启存活。

// ── Gateway Session → SDK Conversation ID 映射持久化 ──
// gateway sessionId (crypto.randomUUID) ≠ SDK conversation id (system_init.session_id)
// 重启/resume 时必须用 SDK 的真 conversation ID 调用 opts.resume，否则 SDK 不识别
//   会创建新 .jsonl → scanProjects 看到两个文件 → "一个会话变两个"
// SIDE_EFFECT: 读写 bridge-session-map.json
function sessionMapPath(workDir) {
    return join(BRIDGE_HOME, 'projects', encodeProjectName(workDir), 'bridge-session-map.json')
}

function loadSessionMap(workDir) {
    return readJSON(sessionMapPath(workDir)) || {}
}

function saveSessionMap(workDir, map) {
    try {
        const fp = sessionMapPath(workDir)
        writeJSON(fp, map)
        return true
    } catch (e) {
        log.warn({err: e}, 'session-map 保存失败')
        return false
    }
}

function sessionVisibilityStorePath(workDir) {
    return join(BRIDGE_HOME, 'projects', encodeProjectName(workDir), 'bridge-session-visibility.json')
}

function saveSessionVisibility(workDir, state) {
    try {
        writeJSON(sessionVisibilityStorePath(workDir), state)
        return true
    } catch (error) {
        log.warn({err: error, workDir}, 'Session 可见性白名单保存失败')
        return false
    }
}

function markVisibleSession(workDir, gatewaySessionId, sdkSessionId, source) {
    const current = loadSessionVisibility(dirname(sessionVisibilityStorePath(workDir)))
    const next = markSessionVisible(current, {gatewaySessionId, sdkSessionId, source})
    const saved = saveSessionVisibility(workDir, next)
    ensureSessionCatalogIdentity(workDir, gatewaySessionId, sdkSessionId, source)
    if (saved) invalidateProjectsCache()
    return saved
}

function removeVisibleSession(workDir, gatewaySessionId, sdkSessionId) {
    const current = loadSessionVisibility(dirname(sessionVisibilityStorePath(workDir)))
    const next = removeSessionVisibility(current, {gatewaySessionId, sdkSessionId})
    const saved = saveSessionVisibility(workDir, next)
    if (saved) invalidateProjectsCache()
    return saved
}

function removeVisibleSessionEverywhere(gatewaySessionId, sdkSessionId = null) {
    const projectsDir = join(BRIDGE_HOME, 'projects')
    try {
        for (const encodedDir of readdirSync(projectsDir)) {
            const projectDir = join(projectsDir, encodedDir)
            if (!statSync(projectDir).isDirectory()) continue
            const current = loadSessionVisibility(projectDir)
            const next = removeSessionVisibility(current, {gatewaySessionId, sdkSessionId})
            if (JSON.stringify(next) === JSON.stringify(current)) continue
            try {
                writeJSON(join(projectDir, 'bridge-session-visibility.json'), next)
            } catch (error) {
                log.warn({err: error, projectDir}, '跨项目清理 Session 可见性失败')
            }
        }
    } catch (error) {
        log.warn({err: error}, '扫描 Session 可见性文件失败')
    }
    invalidateProjectsCache()
}

function getProjectVisibility(workDir) {
    return loadSessionVisibility(dirname(sessionVisibilityStorePath(workDir)))
}

function persistSdkSessionId(workDir, gatewaySessionId, sdkSessionId) {
    const map = updateSessionMap(loadSessionMap(workDir), gatewaySessionId, sdkSessionId)
    const saved = saveSessionMap(workDir, map)
    if (saved) invalidateProjectsCache()
    return saved
}

function removeSdkSessionId(workDir, gatewaySessionId, sdkSessionId) {
    const current = loadSessionMap(workDir)
    const map = removeSessionMapEntry(current, gatewaySessionId, sdkSessionId)
    if (Object.keys(map).length === Object.keys(current).length) return true
    const saved = saveSessionMap(workDir, map)
    if (saved) invalidateProjectsCache()
    return saved
}

function lookupSdkSessionId(workDir, gatewaySessionId) {
    const map = loadSessionMap(workDir)
    return map[gatewaySessionId] || null
}

// 通过 SDK conversation ID 反向查找 gateway sessionId（侧栏 resume 用）
function lookupGatewaySessionId(workDir, sdkSessionId) {
    const map = loadSessionMap(workDir)
    return resolveMappedGatewaySessionId(map, sdkSessionId)
}

// 兜底搜索：path 编码不一致时，跨所有项目目录查找指定 .jsonl
//   验证其 cwd 与给定 workDir 匹配（规范化后忽略大小写），返回 true 表示找到
function findSessionJsonl(sessionId, workDir) {
    const projectsDir = join(BRIDGE_HOME, 'projects')
    const targetFile = sessionId + '.jsonl'
    const normWd = normalizeWorkDir(workDir).toLowerCase()
    try {
        for (const entry of readdirSync(projectsDir)) {
            const full = join(projectsDir, entry)
            if (!statSync(full).isDirectory()) continue
            const jlPath = join(full, targetFile)
            if (!existsSync(jlPath)) continue
            // 校验 cwd 匹配：从 .jsonl 读取 cwd 字段并规范化后比较
            try {
                const head = readFileHeadLines(jlPath, 4096).join('\n')
                const m = head.match(/"cwd":\s*"([^"]+)"/)
                if (m && normalizeWorkDir(m[1]).toLowerCase() === normWd) return true
            } catch (error) {
                log.debug({err: error, path: jlPath}, '读取 Session transcript cwd 失败')
            }
            // 兜底：decodeProjectName 从目录名还原比较
            const decoded = decodeProjectName(entry)
            if (decoded && normalizeWorkDir(decoded).toLowerCase() === normWd) return true
        }
    } catch (error) {
        log.debug({err: error, sessionId: sessionId?.slice(0, 8), projectsDir}, '跨项目查找 Session transcript 失败')
    }
    return false
}

// ── 基线快照持久化（让文件面板「仅改动」在重启/resume 后仍以会话起始为基线）──
// SIDE_EFFECT: 读写 bridge-snapshot/<sessionId>.json
function snapshotStorePath(workDir, sessionId) {
    return join(BRIDGE_HOME, 'projects', encodeProjectName(workDir), 'bridge-snapshot', sessionId + '.json')
}

function saveSnapshot(s, sessionId) {
    try {
        if (!s?.snapshot) return true
        const fp = snapshotStorePath(s.workDir, sessionId)
        // Map 不能直接 JSON，转 entries 数组
        const obj = {
            takenAt: s.snapshot.takenAt,
            truncated: s.snapshot.truncated,
            gitHead: s.snapshot.gitHead || undefined,
            files: [...s.snapshot.files.entries()]
        }
        writeJSON(fp, obj)
        return true
    } catch (e) {
        log.warn({err: e}, 'snapshot 保存失败')
        return false
    }
}

function loadSnapshot(workDir, sessionId) {
    const d = readJSON(snapshotStorePath(workDir, sessionId))
    if (!d || !Array.isArray(d.files)) return null
    return {takenAt: d.takenAt, truncated: !!d.truncated, gitHead: d.gitHead || undefined, files: new Map(d.files)}
}

// 记录点落盘路径：~/.claude-desktop-bridge/projects/<encoded>/bridge-checkpoints/<sessionId>.json
function checkpointStorePath(workDir, sessionId) {
    return join(BRIDGE_HOME, 'projects', encodeProjectName(workDir), 'bridge-checkpoints', sessionId + '.json')
}

// 从磁盘载入历史记录点（resume 续接用）；失败返回空数组
function loadCheckpoints(workDir, sessionId) {
    const d = readJSON(checkpointStorePath(workDir, sessionId))
    return Array.isArray(d?.checkpoints) ? d.checkpoints : []
}

// 落盘当前 session 的记录点（含 before 增量内容）
// SIDE_EFFECT: 写 bridge-checkpoints/<sessionId>.json
function saveCheckpoints(s, sessionId) {
    try {
        const fp = checkpointStorePath(s.workDir, sessionId)
        writeJSON(fp, {workDir: s.workDir, checkpoints: s.checkpoints || []})
        return true
    } catch (e) {
        log.warn({err: e}, 'checkpoint 保存失败')
        return false
    }
}

// ── beginTurn — 回合开始：记录修改前状态（异步快照，不阻塞消息入队）──
// 功能说明: 在 Claude 每轮开始处理用户消息前，异步拍下「修改前」快照并记录 prompt，
//   供 finalizeCheckpoint 在回合结束时对比 diff，生成记录点
// 实现方式: 先占位 pendingTurn（含 prompt + time）→ 消息立即入队 SDK →
//   setImmediate 异步构建 buildFileSnapshot → 填入 preSnapshot
//   构建失败时推进 pendingTurn，后续 finalizeCheckpoint 会跳过该失败回合
// 关键设计: preSnapshot 只在 result 事件时需要（通常几秒后），
//   没必要在消息处理路径上同步阻塞事件循环（大项目 buildFileSnapshot 可达数百 ms）
// SIDE_EFFECT: mutates session.pendingTurn（分两次：同步写 prompt/time，异步写 preSnapshot）
function beginTurn(sessionId, prompt, options = {}) {
    const s = sessions.get(sessionId);
    if (!s) return
    const captureFiles = options.captureFiles !== false
    // 同步占位：prompt + time + _turnId 先落盘，消息立即入队 SDK 不受阻
    const turnId = Symbol('turn')
    const turn = {
        prompt: String(prompt || '').slice(0, 500),
        preSnapshot: null,
        captureFiles,
        time: Date.now(),
        _turnId: turnId
    }
    if (s.pendingTurn) {
        if (!Array.isArray(s._pendingTurns)) s._pendingTurns = []
        s._pendingTurns.push(turn)
        return
    }
    s.pendingTurn = turn
    if (!captureFiles) {
        log.info({sessionId: sessionId?.slice(0, 8)}, '[beginTurn] 轻量问答跳过文件快照')
        return
    }
    // 异步构建快照：增量以 s.snapshot 为 baseline，只重读 mtime/size 变动的文件
    // 用 setImmediate 推迟到当前事件循环 tick 结束后执行，保证消息先入队
    // CAS 守护 _turnId: stop 后立即新消息时，旧 setImmediate 看到 _turnId 不匹配则跳过
    const snapSession = s
    setImmediate(() => {
        try {
            if (!snapSession.pendingTurn || snapSession.pendingTurn._turnId !== turnId) return
            snapSession.pendingTurn.preSnapshot = buildFileSnapshot(snapSession.workDir, snapSession.snapshot)
            log.info({sessionId: sessionId?.slice(0,8), gitHead: !!snapSession.pendingTurn.preSnapshot?.gitHead, fileCount: snapSession.pendingTurn.preSnapshot?.files?.size}, '[beginTurn] 快照已构建')
        } catch (e) {
            log.warn({err: e}, 'beginTurn snapshot 失败');
            if (snapSession.pendingTurn && snapSession.pendingTurn._turnId === turnId) {
                advancePendingTurn(sessionId, snapSession)
            }
        }
    })
}

// ── finalizeCheckpoint — 回合结束：对比修改前后的文件差异，生成记录点 ──
// 功能说明: 在 Claude 每轮完成后（收到 result 事件），diff 本轮修改前(preSnapshot) vs 当前文件状态，
//   识别变更文件及其 before/after 内容，组装 checkpoint 对象追加到 session.checkpoints
// 实现方式:
//   1. diffSnapshotVsCurrent(preSnapshot, currentFiles) → diffMap
//   2. 逐变更文件构造 {path,status,added,removed,before,notRevertible}
//   3. 修改前内容从 preSnapshot.files.get(path).content 获取
//   4. 二进制/超大文件标记 notRevertible=true（无可回退内容）
//   5. checkpointSeq 递增生成唯一 ID (cp-{seq})
//   6. 同步更新 session.snapshot 为当前状态（作为新一轮的基线）
// SIDE_EFFECT: mutates session.checkpoints/snapshot/pendingTurn + 落盘 bridge-checkpoints/<sessionId>.json
function schedulePendingTurnSnapshot(sessionId, snapSession, turn) {
    if (turn.captureFiles === false) return
    setImmediate(() => {
        try {
            if (snapSession.pendingTurn?._turnId !== turn._turnId) return
            turn.preSnapshot = buildFileSnapshot(snapSession.workDir, snapSession.snapshot)
        } catch (e) {
            log.warn({err: e, sessionId: sessionId?.slice(0, 8)}, 'queued turn snapshot failed')
            if (snapSession.pendingTurn?._turnId === turn._turnId) {
                advancePendingTurn(sessionId, snapSession)
            }
        }
    })
}

function advancePendingTurn(sessionId, session) {
    session.pendingTurn = session._pendingTurns?.shift() || null
    if (session.pendingTurn) schedulePendingTurnSnapshot(sessionId, session, session.pendingTurn)
    return session.pendingTurn
}

function finalizeCheckpoint(sessionId) {
    const s = sessions.get(sessionId);
    if (!s || !s.pendingTurn) { log.info({sessionId: sessionId?.slice(0,8), hasSession: !!s, hasPendingTurn: !!s?.pendingTurn}, '[ckpt] 跳过: 无会话或无 pendingTurn'); return null }
    if (s.pendingTurn.captureFiles === false) {
        log.info({sessionId: sessionId?.slice(0, 8)}, '[ckpt] 轻量问答跳过文件 checkpoint')
        advancePendingTurn(sessionId, s)
        return null
    }
    if (!s.pendingTurn.preSnapshot) {
        try {
            s.pendingTurn.preSnapshot = buildFileSnapshot(s.workDir, s.snapshot)
            log.info({sessionId: sessionId?.slice(0,8), gitHead: !!s.pendingTurn.preSnapshot?.gitHead}, '[ckpt] 降级同步构建快照')
        } catch (e) {
            log.warn({err: e}, 'finalizeCheckpoint snapshot 降级构建失败');
            advancePendingTurn(sessionId, s)
            return null
        }
    }
    const currentTurn = s.pendingTurn
    const pre = currentTurn.preSnapshot;
    const prompt = currentTurn.prompt;
    const time = currentTurn.time
    advancePendingTurn(sessionId, s)
    if (!pre) { log.info({sessionId: sessionId?.slice(0,8)}, '[ckpt] 跳过: preSnapshot 为空'); return null }
    const scan = currentFileScan(s.workDir, pre)
    if (scan.missing) { log.info({sessionId: sessionId?.slice(0,8)}, '[ckpt] 跳过: 工作目录不存在'); return null }
    const diffMap = diffSnapshotVsCurrent(pre, scan.files, s.workDir)
    const files = []
    let revertible = true
    for (const [path, d] of diffMap) {
        if (d.status === 'unchanged') continue
        const snap = pre.files.get(path)
        let before = null, notRevertible = false
        if (d.status === 'added') {
            before = null  // 本轮新增 → 回退时删除
        } else {
            // modified / deleted → 需要修改前内容才能回写
            if (snap && !snap.binary && !snap.tooLarge && !snap.readError && typeof snap.content === 'string') before = snap.content
            else {
                notRevertible = true;
                revertible = false
            }  // 二进制/超大/读失败 → 该文件不可回退
        }
        files.push({path, status: d.status, before, notRevertible, added: d.added, removed: d.removed})
    }
    if (!files.length) { log.info({sessionId: sessionId?.slice(0,8), totalDiff: diffMap.size, gitHead: !!pre?.gitHead}, '[ckpt] 跳过: 本轮未改动文件'); return null }  // 本轮没动文件，不建记录点
    if (!s.checkpoints) s.checkpoints = []
    s.checkpointSeq = (s.checkpointSeq || 0) + 1
    const checkpoint = {id: `cp-${s.checkpointSeq}`, prompt, time, files, revertible}
    s.checkpoints.push(checkpoint)
    log.info({sessionId: sessionId?.slice(0,8), cpId: `cp-${s.checkpointSeq}`, fileCount: files.length, gitHead: !!pre?.gitHead}, '[ckpt] 记录点已创建')
    // 裁剪上限，防止长会话无界增长
    if (s.checkpoints.length > 50) s.checkpoints.splice(0, s.checkpoints.length - 50)
    // 异步落盘：in-memory checkpoints 已更新，API 立即可见；磁盘 I/O 不阻塞 result 广播
    const cpSession = s
    setImmediate(() => {
        if (!saveCheckpoints(cpSession, sessionId)) {
            log.warn({sessionId: sessionId?.slice(0, 8)}, '保存 checkpoint 失败')
        }
    })
    // 注意：不要在这里重置 session.snapshot —— 文件面板「仅改动」依赖会话起始基线，
    // 重置会让累计改动清零导致「仅改动」空白。记录点用自己的 per-turn preSnapshot，互不影响。
    return {created: true, ...checkpoint}
}

// 回退到指定记录点之前的状态：倒序撤销该记录点及其之后的所有轮次
// dryRun=true 仅预览受影响文件，不写盘
// ── rewindToCheckpoint — 文件回退到指定记录点 ──
// 功能说明: 将工作目录的所有文件回退到目标 checkpoint 之前的状态
//   倒序遍历从尾部到目标 index 的所有 checkpoint，逐文件还原:
//     added → 删除文件; modified/deleted → 写回 before 内容
//   dryRun=true 时仅计算影响面不实际写盘（用于前置校验）
// 实现方式: 从 cps.length-1 到 idx 倒序处理，每轮按 status 类型决定恢复操作
//   回退完成后截断 checkpoints 数组到 idx 之前，保存到磁盘
// 关键数据流: checkpoints[idx..] → 倒序恢复文件 → cps.slice(0, idx) → saveCheckpoints
// SIDE_EFFECT: 写/删工作目录文件 + 截断 session.checkpoints（不动文件面板基线）
function rewindToCheckpoint(sessionId, checkpointId, dryRun) {
    const s = sessions.get(sessionId);
    if (!s) return {ok: false, error: 'session_not_found'}
    const cps = s.checkpoints || []
    const idx = cps.findIndex(c => c.id === checkpointId)
    if (idx < 0) return {ok: false, error: 'checkpoint_not_found'}
    // 待撤销范围：[idx, 末尾]，倒序应用保证最终回到 idx 轮之前的状态
    const affected = new Set()
    let blocked = []
    for (let i = cps.length - 1; i >= idx; i--) {
        for (const f of cps[i].files) {
            if (f.notRevertible) {
                blocked.push(f.path);
                continue
            }
            affected.add(f.path)
            if (dryRun) continue
            const abs = resolveSafe(s.workDir, f.path)
            if (!abs) continue
            try {
                if (f.status === 'added') {
                    if (existsSync(abs)) unlinkSync(abs)
                }  // 新增 → 删除
                else {
                    if (!existsSync(dirname(abs))) mkdirSync(dirname(abs), {recursive: true});
                    writeFileSync(abs, f.before ?? '', 'utf8')
                }  // 改/删 → 写回
            } catch (e) {
                log.warn({err: e, path: f.path}, 'rewind write 失败')
            }
        }
    }
    if (dryRun) return {ok: true, dryRun: true, files: [...affected], blocked}
    // 截断记录点到 idx 之前 + 落盘（不动 session.snapshot：回退后仍以会话起始为基线对比）
    s.checkpoints = cps.slice(0, idx)
    if (!saveCheckpoints(s, sessionId)) {
        return {ok: false, code: 'persist_failed', error: 'checkpoint 持久化失败', reverted: [...affected], blocked}
    }
    return {ok: true, reverted: [...affected], blocked, remaining: s.checkpoints.length}
}
