import nodeCrypto from 'node:crypto'
import {normalizePermissionMode} from '../agents/agent-permission.mjs'

/** Provider/SDK query options 组装边界。 */
export function createQueryOptionsRuntime(deps = {}) {
    const {
        BRIDGE_HOME, MODEL, VALID_PERMISSION_MODES, VALID_THINKING_LEVELS, VALID_MODEL_MODES,
        restoreSecretValue, getClaudeExe, normalizeContextProfile, routeSkills,
        getBuiltinResourceState, ensureBuiltinSkillsAvailable, decideTask, loadAgentDefinitions,
        shouldDeferAutomaticQuery, mapModel, resolveTaskModelRoute, loadWfConfig,
        shouldValidateProviderModel, validateProviderModel, prepareQueryProvider,
        parseTokenCount, lookupModelInfo, calculateAutoCompactWindow, mapThinkingLevel,
        sanitizeMcpServers, buildChildProcessEnv, buildCavemanSystemPrompt,
        makeCanUseTool, rtkPostToolUseHandler, applyContextProfile, applySkillRoute,
        relative, resolve, basename, dirname, join, rmdirSync, safeChildPath,
        existsSync, unlinkSync, deleteSession, sessions, broadcast, log = console,
        cryptoImpl = nodeCrypto,
    } = deps
    const crypto = cryptoImpl

async function makeQueryOptions(body, workDir, cliS, extraEnv = {}, sessionId = null) {
    // 三源合并: body(前端临时切换) > cliS.env(settings) ; 不读 process.env 避免父进程 env 与 settings 不一致
    const configuredApiKey = cliS.env?.ANTHROPIC_AUTH_TOKEN || cliS.env?.ANTHROPIC_API_KEY || ''
    // 设置接口会脱敏返回 provider key；会话入口必须在 Gateway 内恢复，不能把 [REDACTED] 发给上游。
    const requestedApiKey = restoreSecretValue(body.apiKey || '', configuredApiKey)
    const apiKey = requestedApiKey || configuredApiKey
    let baseUrl = body.baseUrl || cliS.env?.ANTHROPIC_BASE_URL
    const exe = body.claudeExe || process.env.CLAUDE_EXE || cliS.claudeExe || getClaudeExe()
    const permissionMode = normalizePermissionMode(body.permissionMode)
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
    const builtinSkillsState = getBuiltinResourceState({bridgeHome: BRIDGE_HOME}).filter(item => item.type === 'skill')
    const enabledSkills = new Set(builtinSkillsState.filter(item => item.enabled).map(item => item.id))
    const skillRoute = contextProfile === 'light'
        ? []
        : requestedSkillRoute.filter(name => !builtinSkillsState.some(item => item.id === name) || enabledSkills.has(name))
    const builtinSkills = ensureBuiltinSkillsAvailable(skillRoute, {bridgeHome: BRIDGE_HOME})
    if (builtinSkills.installed.length) {
        log.info({skills: builtinSkills.installed}, 'Bridge 内置 Skill 已准备')
    }
    const taskDecisionForResources = body.taskDecision || (body.text ? decideTask({text: body.text}) : null)
    const agents = contextProfile === 'full' ? (body._agents || loadAgentDefinitions(taskDecisionForResources, body.projectContext || null)) : {}

    const requestedModelMode = VALID_MODEL_MODES.has(body.modelMode)
        ? body.modelMode
        : (body.model ? 'fixed' : 'auto')
    const initialDecision = taskDecisionForResources
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
    const {effectiveBaseUrl, sdkApiKey, usesCodexRelay} = await prepareQueryProvider({
        baseUrl,
        apiKey,
        model: resolvedModel,
        deferAutomaticQuery,
    })
    const configuredContextCap = parseTokenCount(body.maxContextTokens || cliS.maxContextTokens)
    const knownContextWindow = parseTokenCount(body.modelMeta?.contextWindow) || lookupModelInfo(resolvedModel).contextWindow
    const autoCompactWindow = calculateAutoCompactWindow(knownContextWindow, configuredContextCap)
    const builtinMcpState = getBuiltinResourceState({bridgeHome: BRIDGE_HOME}).filter(item => item.type === 'mcp')
    const builtinMcpIds = new Set(builtinMcpState.map(item => item.id))
    const enabledBuiltinMcp = new Set(builtinMcpState.filter(item => item.enabled).map(item => item.id))
    const configuredMcpServers = Object.fromEntries(Object.entries(cliS.mcpServers || {})
        .filter(([name]) => !builtinMcpIds.has(name) || enabledBuiltinMcp.has(name)))
    let opts = {
        abortController: new AbortController(),
        model: resolvedModel,
        executable: 'node',
        cwd: workDir,
        permissionMode,
        allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
        thinking: mapThinkingLevel(VALID_THINKING_LEVELS.has(body.thinkingLevel) ? body.thinkingLevel : 'auto'),
        maxTurns: Number.isFinite(requestedMaxTurns) ? Math.min(100, Math.max(1, requestedMaxTurns)) : 40,
        mcpServers: sanitizeMcpServers(configuredMcpServers),
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
    // 仅保存哈希后的稳定配置版本，供重建原因与缓存资格判断；不得把规则/工具正文放入运行事件。
    opts.bridgeToolsetRevision = crypto.createHash('sha256').update(JSON.stringify({
        tools: opts.tools || [], allowedTools: opts.allowedTools || [], mcpServers: Object.keys(opts.mcpServers || {}).sort(),
    })).digest('hex').slice(0, 16)
    opts.bridgeRuleRevision = crypto.createHash('sha256').update(JSON.stringify(opts.systemPrompt || null)).digest('hex').slice(0, 16)
    opts.bridgeProjectContextRevision = crypto.createHash('sha256').update(JSON.stringify(body.projectContext || null)).digest('hex').slice(0, 16)
    // SDK 的 Anthropic client 读 process.env(不读 opts.env)，直接设 process.env
    // 不再 restore: 多个 session 共享 process.env，restore 会导致 A 恢复 B 的值
    return opts
}

    return {makeQueryOptions}
}
