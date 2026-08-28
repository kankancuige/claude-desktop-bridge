/** 会话与偏好 HTTP 路由。只负责契约和编排，状态由组合根通过依赖注入提供。 */
export function createSessionMutationRoutes(deps = {}) {
    const {ADAPTER_CONFIG_PATH, ADAPTER_PLATFORMS, ADAPTER_SESSIONS_PATH, ADAPTER_STARTERS, ADAPTER_TOKENS, ALLOW_TOKEN_ENDPOINT, BINARY_EXTS, BRIDGE_HOME, BRIDGE_PROVIDER_SETTINGS_PATH, BRIDGE_TOKEN, BRIDGE_TOKEN_PATH, BUILTIN_AGENTS, BUILTIN_AGENT_DEFINITIONS, BUILTIN_AGENT_TYPES, BUILTIN_COMMANDS, BUILTIN_MCP, BUILTIN_SKILLS, CAVEMAN_DEFAULT_CONFIG, CAVEMAN_SKILL_DIR, CAVEMAN_SKILL_FILE, CAVEMAN_VALID_LEVELS, CAVEMAN_VERSION_FILE, CHILD_ENV_KEYS, DELETED_SESSIONS_FILE, DYNAMIC_CACHE_FILE, IM_CUSTOM_COMMANDS, IM_SOURCES, MAX_OCR_CONCURRENT, MAX_REMOTE_TEXT_BYTES, MAX_RTK_ARCHIVE_BYTES, MAX_SCHEDULED_CONCURRENT, MAX_SCHEDULED_DURATION_MS, MAX_SESSION_INPUT_QUEUE, MAX_SNAP_FILES, MAX_SNAP_FILE_BYTES, MODEL, NUDGE_ACTIONS, PKG_VERSION, PORT, PROJECTS_CACHE_TTL, PROJECT_CACHE_IDLE_DELAY_MS, PROVIDERS, PushStream, RTK_CRITICAL_PATTERN, RTK_READONLY_CROSS, RTK_READONLY_PREFIXES, RTK_READONLY_UNIX, RTK_REJECT_RATIO, RTK_TIMEOUT, SCHEDULED_TASKS_FILE, SECURE_PAYLOAD_KEY_PATH, SNAP_EXCLUDE_DIRS, SessionEventJournal, UPLOAD_QUOTA_BYTES, UPLOAD_TTL_MS, VALID_MODEL_MODES, VALID_PERMISSION_MODES, VALID_THINKING_LEVELS, WF_CONFIG_FILE, WF_TIER_MAP, WORKFLOW_TRIGGERS, WS_PING_INTERVAL, WS_PING_TIMEOUT, WX_MARKER_RESERVE, WX_MAX_BYTES, WebSocketServer, __dirname, _deletedDirty, _deletedPersistRetryCount, _deletedPersistScheduled, _deletedSessionIds, _exe, _ocProxyStarting, _persistDynamicTimer, _projectsCache, _proxyStarting, _scanningProjects, _schedulePersistDeleted, acceptSessionInput, activeOcr, adapterConfigReadError, adapterOwnsFocusedSession, adapterOwnsProject, adapterOwnsSession, adapterRouteAllowed, advancePendingTurn, analyzeMessageForWorkflow, appendSessionEvent, applyContextProfile, applySkillRoute, applyTaskCompletionEffects, armStreamWatchdog, attachTaskWorkflow, authenticateBridgeToken, autoTriggerFinalReview, autoTriggerWorkflow, backupFile, basename, beginTurn, bootGateway, bridgeStateDb, broadcast, broadcastDesktop, broadcastTaskLifecycle, broadcastTurn, broadcastWorkflowEvent, buildAgentDescriptor, buildAgentToolLifecycleEvent, buildCacheInjectionText, buildCavemanSystemPrompt, buildChildProcessEnv, buildFileSnapshot, buildGitContext, buildGitSnapshot, buildIncompleteMirrorText, buildModelHandoffPrompt, buildProjectCache, buildProjectContext, buildProjectContinuationContext, buildProviderFallbackUrls, buildProviderModelsUrl, buildSessionStopResponse, buildSystemInitEvent, buildTaskPitfallReminder, buildWindowsRtkExtractArgs, buildWindowsRtkExtractEnv, builtinCache, cacheFilePath, calculateAutoCompactWindow, canResumeTask, cancelPendingSessionInputs, checkAiLayerHealth, checkCavemanUpdate, checkRtkUpdate, checkpointStorePath, classifyContextProfile, classifyTaskResult, classifyTranscriptFile, claudeAgentProvider, cleanupOrphanSessionDirs, cleanupSessionUploads, cleanupUploadDir, clearAdapterBindings, clearAdapterBindingsForSessions, clearAdapterPlatformState, clearPlatformEntries, clearStreamWatchdog, clearTaskWorkflowGate, closeSessionRuntime, closeSync, collectTranscriptProjectGroups, commitWorkflow, compactBoundaryToEvent, compareSemver, composeContinuationPrompt, computeLineDiff, configureSecurePayloadMasterKey, confirmHooks, consumePendingSessionInputOnResult, consumeTaskWorkflowResultTurn, contextUsageEvent, controlClients, convertSdkToWs, coordinatorPersistence, createAgentRegistry, createCommandVerificationAdapter, createCoordinatorPersistence, createImProgressPolicy, createImProgressReporter, createLogger, createMemoryService, createModelUsageEvent, createPinnedLookup, createPitfallAdmin, createPitfallService, createPostgresStateCompat, createProviderConfigRoutes, createProviderRegistry, createResourceConfigRoutes, createRuntimeAgentRegistry, createSdkStreamAdapter, createServer, createSessionContextEnvelope, createSessionCoordinator, createSessionRuntime, createStorageGateway, createTaskCommandService, createTaskCompletionState, createTaskCoordinator, createTaskInputQueue, createTaskLifecycleSnapshot, createTaskPlan, createTaskStatePatch, createTaskWorkbenchRuntime, createTaskWorkflowGate, createTurnIdentity, createUserPreferenceService, createVerificationAdapterRegistry, createVerificationCampaignService, cron, cronJobs, crypto, currentFileScan, decideTask, decisionToResult, decodeProjectName, deferPrimaryResultForTaskWorkflow, deleteProjectMemory, deleteSession, deleteSessionFiles, deleteWorkflowFile, describeAttachment, destroyScheduledJob, detectRuleDrift, diffSnapshotVsCurrent, dirname, downloadAndReplaceCaveman, downloadAndReplaceRtk, dynamicCache, encodeProjectName, ensureBuiltinSkillsAvailable, ensurePostgresSchema, ensureSessionCatalogIdentity, execFileSync, execSync, executeScheduledTask, existsSync, extractBridgeProviderSettings, extractSemver, extractWebSocketToken, failPendingSessionInputs, fetchProviderResponse, fileURLToPath, filterDeletedSessions, finalizeCheckpoint, findGitBashDirs, findSessionJsonl, findSessionTranscript, finishImProgressReporters, finishScheduledRun, finishTaskWorkflowResultTurn, focusedSessionId, forkSession, getAdapterHook, getAdapterIdentity, getBuiltinResourceState, getClaudeExe, getCodexRelayProxyUrl, getGitHead, getLastModified, getLiveQuery, getOpenCodeProxyUrl, getPersistedMirrors, getProjectVisibility, getProxyUrl, getRtkDir, getRunState, getSessionRuntimeState, getSessionStopScope, getSessionWorkflowState, getSessionWorkflowStates, getTaskLifecycleSnapshot, getUploadDir, getWorkflow, handleNotificationStateChange, hasPendingTaskWorkflow, hasPersistedNotificationIntents, hasStoppableSessionWork, homedir, httpRequest, httpsRequest, imProgressPolicy, imProgressRecipients, imProgressReporterKey, imProgressReporters, initialSessionIdentity, initializeSecurePayloadKey, initializeTaskWorkbenchSession, invalidateProjectsCache, isAdapterSessionActive, isAgentTranscriptByContent, isAutoContinuationPrompt, isBinaryPath, isDirectoryPath, isExplorationAttempt, isImageAttachment, isInternalWorkflowResultText, isOpenCodeProxyRunning, isProxyConfiguredFor, isReadOnlyCommand, isSyntheticCompactSummary, isUserSessionSource, isValidSessionId, join, journalTaskState, labelForChoice, lcsLength, lineDiffStats, listAdapterBindings, listProjectMemory, listProjectSessions, listProjectTranscriptCandidates, listWorkflows, loadAdapterConfig, loadAgentDefinitions, loadBridgeProviderSettings, loadCavemanConfig, loadCheckpoints, loadCliSettings, loadCliSettingsForUpdate, loadEnv, loadProjectCache, loadProjectVisibilityWithMigration, loadRtkConfig, loadSessionMap, loadSessionVisibility, loadSnapshot, loadTaskState, loadWfConfig, locateRtk, log, logHttpRequest, looksLikeIncompleteTransportFailure, lookupGatewaySessionId, lookupModelInfo, lookupSdkSessionId, lstatSync, makeCanUseTool, makeQueryOptions, mapModel, mapThinkingLevel, markInternalInput, markSessionDeleted, markSessionVisible, markVisibleSession, maybeInjectGitContext, maybeInjectProjectCache, maybeMirror, maybeRefreshContextUsage, maybeUpdateProjectCache, memoryService, migrateAdapterConfig, migrateAdapterCredentials, migrateLegacySessionVisibility, mirrorSessionIds, mirrorStorePath, mkdirSync, normalizeAdapterBindings, normalizeBridgeProviderSettings, normalizeContextProfile, normalizeExplicitModel, normalizeReviewOutcome, normalizeWeChatBaseUrl, normalizeWorkDir, noteTaskWorkflowTerminal, notificationTaskId, openSessionEventJournal, openSync, overlayBridgeProviderSettings, parseContextWindow, parseDeepSeekBalance, parseFrontmatter, parseMeta, parseMultipart, parsePricingPrice, parseSessionHistory, parseShellArgs, parseTokenCount, pendingQRCodes, persistBridgeToken, persistDynamicCache, persistSdkSessionId, persistSessionCatalogSettings, persistSessionMirrors, persistTaskStateProjection, pitfallAdmin, pitfallService, platformEntryFilePath, prepareBridgeHome, prepareUploadDir, presetRunState, projectCacheBuilds, providerRegistry, publishVerificationInconclusive, query, queryHistory, readAdapterBindings, readAdapterConfig, readBody, readFetchBodyLimited, readFileHeadLines, readFileSync, readJSON, readNotificationSummary, readSessionCatalogSettings, readStorageConfigFile, readSync, readdirSync, rebuildProjectMemory, reconcilePersistedNotificationIntents, reconcileSessionCatalog, reconcileTaskNotificationIntents, recordProviderUsage, recoverTaskState, redactSecretMap, refreshContextUsage, registerScheduledJob, rejectWebSocketUpgrade, relative, removeAdapterBindings, removePersistedMirrors, removePersistedSessionMirrors, removeSdkSessionId, removeSessionArtifact, removeSessionMapEntry, removeSessionVisibility, removeVisibleSession, removeVisibleSessionEverywhere, renameSync, repairPersistedTaskState, reportImProgressEvent, reqCounter, requestCoordinatorCompletion, requestGatewayShutdown, requestPinnedProvider, requiredTaskNotificationPlatforms, requirementsForAgentStart, resolve, resolveAutoContinuation, resolveBalanceProvider, resolveContextReusePolicy, resolveFinalReviewPlan, resolveFromPkgDir, resolveMappedGatewaySessionId, resolvePrimaryStopTurnId, resolveProviderCapabilityProfile, resolveProviderRedirect, resolveProviderUrl, resolveRequiredNotificationPlatforms, resolveResumeModel, resolveRtkCommandArgs, resolveSafe, resolveSdkInputContent, resolveSessionCreateMode, resolveSessionResume, resolveTaskAgents, resolveTaskModelRoute, resolveTaskPhases, resolveTranscriptProjectWorkDir, resolveTurnModelRoute, resolveWorkflowFinalReviewTier, restartAdapter, restoreCoordinatorSnapshot, restoreSecretMap, restoreSecretValue, restoreSessionMirrors, resumeScheduledTasks, resumeWorkflow, resumeWorkflowAgent, rewindToCheckpoint, rmSync, rmdirSync, rollbackSessionInput, routeSkills, rtkPostToolUseHandler, runCoordinatorRootCauseAnalysis, runCoordinatorValidation, runWfScript, safeBasename, safeChildPath, safeDecodeURIComponent, sanitizeMcpServers, saveAdapterConfig, saveBridgeProviderSettings, saveCavemanConfig, saveCheckpoints, saveProjectCache, saveProjectMemory, saveRtkConfig, saveSessionMap, saveSessionVisibility, saveSnapshot, saveTaskState, saveWfConfig, saveWorkflow, scanGitFiles, scanProjects, scanWorkdirFiles, schedulePendingTurnSnapshot, scheduleProjectCacheBuild, scheduleSessionBackgroundInitialization, scheduledRuns, scheduledTasks, sdkStreamAdapter, selectCancelledInputTurns, selectRtkReleaseAsset, sendManualImText, sendWeChatChunks, sessionCatalogIds, sessionCatalogProjectKey, sessionCoordinator, sessionEventStorePath, sessionMapPath, sessionMirrorIds, sessionMirrorStorePath, sessionVisibilitySource, sessionVisibilityStorePath, sessions, setBuiltinResourceEnabled, setDeps, setPersistedMirror, setPersistedMirrors, setProjectMemoryEnabled, settlePending, shouldAutoTriggerWorkflow, shouldCaptureTurnCheckpoint, shouldDeferAutomaticQuery, shouldDeliverTurnEvent, shouldRouteMirror, shouldShowSession, shouldValidateProviderModel, shutdownGateway, shuttingDown, snapshotStorePath, spawn, spawnRtk, spawnSync, splitByBytes, startAdapter, startClaudeAgent, startCodexRelayProxy, startDeepSeekProxy, startDingTalkAdapter, startFeishuAdapter, startOpenCodeProxy, startStreamPump, startWeChatAdapter, statSync, stateRepositories, stateStoreDegradedReason, stopAdapter, stopCodexRelayProxy, stopDeepSeekProxy, stopOpenCodeProxy, stopSessionGeneration, stopWorkflow, stopWorkflowAgent, storageGateway, stripBridgeProviderSettings, submitTaskCommand, takeDeferredPrimaryResult, taskCommands, taskCompletionEventForClient, taskCoordinator, taskInputQueue, taskStateFileId, taskStateForClient, taskStateForError, taskStateForInconclusive, taskStateForSessionClient, taskStateForStop, taskStateFromCompletion, taskStateStorePath, taskStateWithNotificationIntents, taskWorkbench, taskWorkflowResultIdFromMessage, tokenMatches, transitionTaskCompletion, trustedValidationCommands, unlinkSync, updateProjectCache, updateSessionMap, updateTaskCompletion, updateTaskNotificationState, updateTaskState, upsertAdapterBinding, userPreferences, validateHooks, validateProviderModel, validateProviderUrl, validateWorkflowContent, verifyRtkAssetDigest, withTimeout, writeAdapterBindings, writeAdapterConfig, writeFileSync, writeJSON, wsPingTimer, wss} = deps
    const {resolveRecoveryRuntimeIdentity} = deps
    const getFocusedSessionId = typeof deps.getFocusedSessionId === 'function'
        ? deps.getFocusedSessionId
        : () => deps.focusedSessionId || null
    const setFocusedSessionId = typeof deps.setFocusedSessionId === 'function' ? deps.setFocusedSessionId : () => {}
    const getRepositories = typeof deps.getRepositories === 'function' ? deps.getRepositories : () => ({})
    return async function handleSessionMutationRoute({req, res, url} = {}) {
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
            || (body.recoverSessionId !== undefined && !isValidSessionId(body.recoverSessionId))
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
        } else if (createMode.mode === 'recover') {
            // 仅恢复 Gateway 持久化状态，不向 SDK 传 resume；用户点击继续后才创建新的 SDK query。
            sessionId = createMode.sourceSessionId
        }
        // 重启后前端旧快照通常仍会带 default；已有会话的非 default 权限以服务端持久化值为准。
        // 用户在会话中主动切回 default 后，持久化值也会变为 default，不会阻止后续切换。
        const persistedCatalogKey = sessionCatalogProjectKey(workDir)
        const persistedCatalogIds = createMode.mode === 'resume'
            ? [body.resume, lookupSdkSessionId(workDir, body.resume)]
            : createMode.mode === 'recover' ? [sessionId]
            : createMode.mode === 'fork' ? [forkSourceId] : []
        const sessionRepository = getRepositories()?.session
        const persistedCatalogState = sessionRepository
            ? persistedCatalogIds.map(id => id ? sessionRepository.get({projectKey: persistedCatalogKey, sessionId: id}) : null).find(Boolean) || null
            : null
        const persistedResumeState = createMode.mode === 'resume'
            ? (loadTaskState(workDir, resumeSid || body.resume) || null)
            : createMode.mode === 'recover'
                ? (loadTaskState(workDir, sessionId) || null)
            : createMode.mode === 'fork'
                ? (loadTaskState(workDir, forkSourceId) || null)
                : null
        if (createMode.mode === 'recover' && (!persistedResumeState
            || persistedResumeState.status === 'succeeded'
            || persistedResumeState.resumable !== true)) {
            res.writeHead(404)
            res.end(JSON.stringify({
                error: '可恢复的任务状态不存在',
                code: 'SESSION_RECOVERY_STATE_NOT_FOUND',
            }))
            return
        }
        const persistedPermissionMode = VALID_PERMISSION_MODES.has(persistedResumeState?.permissionMode)
            ? persistedResumeState.permissionMode
            : VALID_PERMISSION_MODES.has(persistedCatalogState?.permissionMode)
                ? persistedCatalogState.permissionMode
            : null
        if (persistedPermissionMode && persistedPermissionMode !== 'default' && body.permissionMode === 'default') {
            body.permissionMode = persistedPermissionMode
        }
        const resumedModel = resolveResumeModel({
            createMode: createMode.mode,
            requestedModel: body.model,
            persistedModel: persistedResumeState?.model,
        })
        if (resumedModel) body.model = resumedModel
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
                setFocusedSessionId(sessionId)
                res.writeHead(200);
                res.end(JSON.stringify({sessionId, workDir, resumed: true, historySessionId: oldSess.lastSessionId || resumeSid,
                    permissionMode: oldSess.permissionMode || 'default',
                    taskState: taskStateForClient(oldSess.taskState),
                    gitInfo: sessions.get(sessionId)?.snapshot?.gitHead || null}));
                return
            }
            const deferAutomaticQuery = createMode.mode === 'recover' || (createMode.mode === 'new' && shouldDeferAutomaticQuery({
                modelMode: opts.bridgeModelMode,
                hasTaskDecision: Boolean(opts.bridgeTaskDecision),
                hasConversationTarget: false,
            }))
            const eventJournal = openSessionEventJournal(workDir, sessionId)
            const q = deferAutomaticQuery ? null : startClaudeAgent(pushStream, opts)
            // 清理已死的旧会话资源
            if (oldSess) {
                await closeSessionRuntime(oldSess, {sessionId, reason: 'replace_stale_session'})
                oldSess.query = null
                oldSess.pushStream = null
                oldSess.eventJournal?.close()
            }
            // recovery-only 不向 SDK 传 resume，但运行时仍需保留历史 conversation identity，
            // 这样用户点击输入框继续时，首条消息才能按原会话重建 query。
            const runtimeIdentity = createMode.mode === 'recover'
                ? resolveRecoveryRuntimeIdentity(persistedResumeState)
                : resumeSid
            sessions.set(sessionId, createSessionRuntime({
                query: q,
                pushStream: deferAutomaticQuery ? null : pushStream,
                workDir,
                opts,
                identity: runtimeIdentity,
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
            const persistedTaskState = repairPersistedTaskState(
                resumeSid || createMode.mode === 'recover'
                    ? (loadTaskState(workDir, resumeSid || sessionId) || journalTaskProjection || loadTaskState(workDir, sessionId))
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
            // 重启恢复时把持久化的 Agent 写入委托放回运行时账本，后续主任务结果才能继续
            // 做 changedFiles 对账并解除 Agent blocked 门禁；成功终态不保留旧委托。
            createdSession._pendingAgentWriteRequests = createdSession.taskState.status === 'succeeded'
                ? []
                : (Array.isArray(createdSession.taskState.writeRequests) ? createdSession.taskState.writeRequests : [])
            createdSession._agentWriteRequestIds = new Set(createdSession._pendingAgentWriteRequests.map(item =>
                `${item.agentRunId || ''}:${(item.writeRequest?.requestedFiles || []).join('|')}`))
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
            const workbenchRepository = getRepositories()?.workbench
            if (persistedTaskState?.taskId && workbenchRepository?.getCoordinatorTask) {
                const coordinatorRecord = workbenchRepository.getCoordinatorTask({
                    projectKey: sessionCatalogProjectKey(workDir), taskId: persistedTaskState.taskId,
                })
                const coordinatorSnapshot = restoreCoordinatorSnapshot(coordinatorRecord, {workDir})
                if (coordinatorSnapshot) {
                    taskWorkbench.restoreTask(coordinatorSnapshot)
                    createdSession.coordinatorTaskId = coordinatorSnapshot.taskId
                }
            }
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
            setFocusedSessionId(sessionId)
            if (q) startStreamPump(sessionId)
            invalidateProjectsCache()
            res.writeHead(201);
            res.end(JSON.stringify({sessionId, workDir, resumed: createMode.mode === 'resume', recovered: createMode.mode === 'recover', forked: createMode.mode === 'fork', forkedFrom,
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
        const focusedId = getFocusedSessionId()
        if (focusedId && sessions.has(focusedId)) {
            const s = sessions.get(focusedId);
            res.writeHead(200);
            res.end(JSON.stringify({sessionId: focusedId, workDir: s.workDir}))
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
        setFocusedSessionId(sid)
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
        const body = await readBody(req)
        if (!NUDGE_ACTIONS.has(body.action) || !body.args || typeof body.args !== 'object' || Array.isArray(body.args)) {
            res.writeHead(400); res.end(JSON.stringify({error: 'invalid nudge'})); return
        }
        // 导航命令走桌面控制通道，不依赖当前 Session；stop 仍必须属于当前聚焦 Session。
        if (identity && body.action === 'stop' && !adapterOwnsFocusedSession(identity)) {
            res.writeHead(403); res.end(JSON.stringify({error: 'session ownership mismatch'})); return
        }
        const nudge = {type: 'nudge', action: body.action, args: body.args || {}, nudgeId: crypto.randomUUID(), source: body.source || 'hook'}
        let delivered = false
        const focusedId = getFocusedSessionId()
        const directAdapterStop = body.action === 'stop' && identity && focusedId && sessions.has(focusedId)
        let stopped = false
        if (directAdapterStop) {
            const result = await stopSessionGeneration(focusedId, sessions.get(focusedId))
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
    //   3. pushStream.close() + Query.close() 关闭 SDK query（旧 SDK 才回退 return）
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
        if (getFocusedSessionId() === id) setFocusedSessionId(null)
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
        let persisted = null
        const requestedWorkDir = normalizeWorkDir(url.searchParams.get('workDir') || '')
        if (!s && isDirectoryPath(requestedWorkDir)) persisted = loadTaskState(requestedWorkDir, eid)
        if (persisted && persisted.status === 'running') persisted = recoverTaskState(persisted)
        if (!s && persisted && persisted.status !== 'succeeded' && persisted.resumable === true) {
            res.writeHead(200)
            res.end(JSON.stringify({
                exists: false,
                persisted: true,
                sessionId: eid,
                workDir: requestedWorkDir,
                taskState: taskStateForClient(persisted),
            }))
            return
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
                if (getFocusedSessionId() === id) setFocusedSessionId(null)
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

        return false
    }
}
