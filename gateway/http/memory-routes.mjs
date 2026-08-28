/** 项目、历史和项目 Memory HTTP 路由。 */
export function createMemoryRoutes(deps = {}) {
    const getMemoryService = typeof deps.getMemoryService === 'function' ? deps.getMemoryService : () => deps.memoryService
    const {ADAPTER_CONFIG_PATH, ADAPTER_PLATFORMS, ADAPTER_SESSIONS_PATH, ADAPTER_STARTERS, ADAPTER_TOKENS, ALLOW_TOKEN_ENDPOINT, BINARY_EXTS, BRIDGE_HOME, BRIDGE_PROVIDER_SETTINGS_PATH, BRIDGE_TOKEN, BRIDGE_TOKEN_PATH, BUILTIN_AGENTS, BUILTIN_AGENT_DEFINITIONS, BUILTIN_AGENT_TYPES, BUILTIN_COMMANDS, BUILTIN_MCP, BUILTIN_SKILLS, CAVEMAN_DEFAULT_CONFIG, CAVEMAN_SKILL_DIR, CAVEMAN_SKILL_FILE, CAVEMAN_VALID_LEVELS, CAVEMAN_VERSION_FILE, CHILD_ENV_KEYS, DELETED_SESSIONS_FILE, DYNAMIC_CACHE_FILE, IM_CUSTOM_COMMANDS, IM_SOURCES, MAX_OCR_CONCURRENT, MAX_REMOTE_TEXT_BYTES, MAX_RTK_ARCHIVE_BYTES, MAX_SCHEDULED_CONCURRENT, MAX_SCHEDULED_DURATION_MS, MAX_SESSION_INPUT_QUEUE, MAX_SNAP_FILES, MAX_SNAP_FILE_BYTES, MODEL, NUDGE_ACTIONS, PKG_VERSION, PORT, PROJECTS_CACHE_TTL, PROJECT_CACHE_IDLE_DELAY_MS, PROVIDERS, PushStream, RTK_CRITICAL_PATTERN, RTK_READONLY_CROSS, RTK_READONLY_PREFIXES, RTK_READONLY_UNIX, RTK_REJECT_RATIO, RTK_TIMEOUT, SCHEDULED_TASKS_FILE, SECURE_PAYLOAD_KEY_PATH, SNAP_EXCLUDE_DIRS, SessionEventJournal, UPLOAD_QUOTA_BYTES, UPLOAD_TTL_MS, VALID_MODEL_MODES, VALID_PERMISSION_MODES, VALID_THINKING_LEVELS, WF_CONFIG_FILE, WF_TIER_MAP, WORKFLOW_TRIGGERS, WS_PING_INTERVAL, WS_PING_TIMEOUT, WX_MARKER_RESERVE, WX_MAX_BYTES, WebSocketServer, __dirname, _deletedDirty, _deletedPersistRetryCount, _deletedPersistScheduled, _deletedSessionIds, _exe, _ocProxyStarting, _persistDynamicTimer, _projectsCache, _proxyStarting, _scanningProjects, _schedulePersistDeleted, acceptSessionInput, activeOcr, adapterConfigReadError, adapterOwnsFocusedSession, adapterOwnsProject, adapterOwnsSession, adapterRouteAllowed, advancePendingTurn, analyzeMessageForWorkflow, appendSessionEvent, applyContextProfile, applySkillRoute, applyTaskCompletionEffects, armStreamWatchdog, attachTaskWorkflow, authenticateBridgeToken, autoTriggerFinalReview, autoTriggerWorkflow, backupFile, basename, beginTurn, bootGateway, bridgeStateDb, broadcast, broadcastDesktop, broadcastTaskLifecycle, broadcastTurn, broadcastWorkflowEvent, buildAgentDescriptor, buildAgentToolLifecycleEvent, buildCacheInjectionText, buildCavemanSystemPrompt, buildChildProcessEnv, buildFileSnapshot, buildGitContext, buildGitSnapshot, buildIncompleteMirrorText, buildModelHandoffPrompt, buildProjectCache, buildProjectContext, buildProjectContinuationContext, buildProviderFallbackUrls, buildProviderModelsUrl, buildSessionStopResponse, buildSystemInitEvent, buildTaskPitfallReminder, buildWindowsRtkExtractArgs, buildWindowsRtkExtractEnv, builtinCache, cacheFilePath, calculateAutoCompactWindow, canResumeTask, cancelPendingSessionInputs, checkAiLayerHealth, checkCavemanUpdate, checkRtkUpdate, checkpointStorePath, classifyContextProfile, classifyTaskResult, classifyTranscriptFile, claudeAgentProvider, cleanupOrphanSessionDirs, cleanupSessionUploads, cleanupUploadDir, clearAdapterBindings, clearAdapterBindingsForSessions, clearAdapterPlatformState, clearPlatformEntries, clearStreamWatchdog, clearTaskWorkflowGate, closeSessionRuntime, closeSync, collectTranscriptProjectGroups, commitWorkflow, compactBoundaryToEvent, compareSemver, composeContinuationPrompt, computeLineDiff, configureSecurePayloadMasterKey, confirmHooks, consumePendingSessionInputOnResult, consumeTaskWorkflowResultTurn, contextUsageEvent, controlClients, convertSdkToWs, coordinatorPersistence, createAdapterConfigRoutes, createAgentRegistry, createCommandVerificationAdapter, createCoordinatorPersistence, createImProgressPolicy, createImProgressReporter, createLogger, createMemoryRoutes, createMemoryService, createModelUsageEvent, createPinnedLookup, createPitfallAdmin, createPitfallService, createPostgresStateCompat, createProviderConfigRoutes, createProviderRegistry, createResourceConfigRoutes, createRuntimeAgentRegistry, createSdkStreamAdapter, createServer, createSessionContextEnvelope, createSessionCoordinator, createSessionFileRoutes, createSessionMutationRoutes, createSessionRuntime, createStorageGateway, createTaskCommandService, createTaskCompletionState, createTaskCoordinator, createTaskInputQueue, createTaskLifecycleSnapshot, createTaskPlan, createTaskStatePatch, createTaskWorkbenchRuntime, createTaskWorkflowGate, createTurnIdentity, createUserPreferenceService, createVerificationAdapterRegistry, createVerificationCampaignService, createWorkflowRoutes, cron, cronJobs, crypto, currentFileScan, decideTask, decisionToResult, decodeProjectName, deferPrimaryResultForTaskWorkflow, deleteProjectMemory, deleteSession, deleteSessionFiles, deleteWorkflowFile, describeAttachment, destroyScheduledJob, detectRuleDrift, diffSnapshotVsCurrent, dirname, downloadAndReplaceCaveman, downloadAndReplaceRtk, dynamicCache, encodeProjectName, ensureBuiltinSkillsAvailable, ensurePostgresSchema, ensureSessionCatalogIdentity, execFileSync, execSync, executeScheduledTask, existsSync, extractBridgeProviderSettings, extractSemver, extractWebSocketToken, failPendingSessionInputs, fetchProviderResponse, fileURLToPath, filterDeletedSessions, finalizeCheckpoint, findGitBashDirs, findSessionJsonl, findSessionTranscript, finishImProgressReporters, finishScheduledRun, finishTaskWorkflowResultTurn, focusedSessionId, forkSession, getAdapterHook, getAdapterIdentity, getBuiltinResourceState, getClaudeExe, getCodexRelayProxyUrl, getGitHead, getLastModified, getLiveQuery, getOpenCodeProxyUrl, getPersistedMirrors, getProjectVisibility, getProxyUrl, getRtkDir, getRunState, getSessionRuntimeState, getSessionStopScope, getSessionWorkflowState, getSessionWorkflowStates, getTaskLifecycleSnapshot, getUploadDir, getWorkflow, handleNotificationStateChange, hasPendingTaskWorkflow, hasPersistedNotificationIntents, hasStoppableSessionWork, homedir, httpRequest, httpsRequest, imProgressPolicy, imProgressRecipients, imProgressReporterKey, imProgressReporters, initialSessionIdentity, initializeSecurePayloadKey, initializeTaskWorkbenchSession, invalidateProjectsCache, isAdapterSessionActive, isAgentTranscriptByContent, isAutoContinuationPrompt, isBinaryPath, isDirectoryPath, isExplorationAttempt, isImageAttachment, isInternalWorkflowResultText, isOpenCodeProxyRunning, isProxyConfiguredFor, isReadOnlyCommand, isSyntheticCompactSummary, isUserSessionSource, isValidSessionId, join, journalTaskState, labelForChoice, lcsLength, lineDiffStats, listAdapterBindings, listProjectMemory, listProjectSessions, listProjectTranscriptCandidates, listWorkflows, loadAdapterConfig, loadAgentDefinitions, loadBridgeProviderSettings, loadCavemanConfig, loadCheckpoints, loadCliSettings, loadCliSettingsForUpdate, loadEnv, loadProjectCache, loadProjectVisibilityWithMigration, loadRtkConfig, loadSessionMap, loadSessionVisibility, loadSnapshot, loadTaskState, loadWfConfig, locateRtk, log, logHttpRequest, looksLikeIncompleteTransportFailure, lookupGatewaySessionId, lookupModelInfo, lookupSdkSessionId, lstatSync, makeCanUseTool, makeQueryOptions, mapModel, mapThinkingLevel, markInternalInput, markSessionDeleted, markSessionVisible, markVisibleSession, maybeInjectGitContext, maybeInjectProjectCache, maybeMirror, maybeRefreshContextUsage, maybeUpdateProjectCache, memoryService, migrateAdapterConfig, migrateAdapterCredentials, migrateLegacySessionVisibility, mirrorSessionIds, mirrorStorePath, mkdirSync, normalizeAdapterBindings, normalizeBridgeProviderSettings, normalizeContextProfile, normalizeExplicitModel, normalizeReviewOutcome, normalizeWeChatBaseUrl, normalizeWorkDir, noteTaskWorkflowTerminal, notificationTaskId, openSessionEventJournal, openSync, overlayBridgeProviderSettings, parseContextWindow, parseDeepSeekBalance, parseFrontmatter, parseMeta, parseMultipart, parsePricingPrice, parseSessionHistory, parseShellArgs, parseTokenCount, pendingQRCodes, persistBridgeToken, persistDynamicCache, persistSdkSessionId, persistSessionCatalogSettings, persistSessionMirrors, persistTaskStateProjection, pitfallAdmin, pitfallService, platformEntryFilePath, prepareBridgeHome, prepareUploadDir, presetRunState, projectCacheBuilds, providerRegistry, publishVerificationInconclusive, query, queryHistory, readAdapterBindings, readAdapterConfig, readBody, readFetchBodyLimited, readFileHeadLines, readFileSync, readJSON, readNotificationSummary, readSessionCatalogSettings, readStorageConfigFile, readSync, readdirSync, rebuildProjectMemory, reconcilePersistedNotificationIntents, reconcileSessionCatalog, reconcileTaskNotificationIntents, recordProviderUsage, recoverTaskState, redactSecretMap, refreshContextUsage, registerScheduledJob, rejectWebSocketUpgrade, relative, removeAdapterBindings, removePersistedMirrors, removePersistedSessionMirrors, removeSdkSessionId, removeSessionArtifact, removeSessionMapEntry, removeSessionVisibility, removeVisibleSession, removeVisibleSessionEverywhere, renameSync, repairPersistedTaskState, reportImProgressEvent, reqCounter, requestCoordinatorCompletion, requestGatewayShutdown, requestPinnedProvider, requiredTaskNotificationPlatforms, requirementsForAgentStart, resolve, resolveAutoContinuation, resolveBalanceProvider, resolveContextReusePolicy, resolveFinalReviewPlan, resolveFromPkgDir, resolveMappedGatewaySessionId, resolvePrimaryStopTurnId, resolveProviderCapabilityProfile, resolveProviderRedirect, resolveProviderUrl, resolveRequiredNotificationPlatforms, resolveResumeModel, resolveRtkCommandArgs, resolveSafe, resolveSdkInputContent, resolveSessionCreateMode, resolveSessionResume, resolveTaskAgents, resolveTaskModelRoute, resolveTaskPhases, resolveTranscriptProjectWorkDir, resolveTurnModelRoute, resolveWorkflowFinalReviewTier, restartAdapter, restoreCoordinatorSnapshot, restoreSecretMap, restoreSecretValue, restoreSessionMirrors, resumeScheduledTasks, resumeWorkflow, resumeWorkflowAgent, rewindToCheckpoint, rmSync, rmdirSync, rollbackSessionInput, routeSkills, rtkPostToolUseHandler, runCoordinatorRootCauseAnalysis, runCoordinatorValidation, runWfScript, safeBasename, safeChildPath, safeDecodeURIComponent, sanitizeMcpServers, saveAdapterConfig, saveBridgeProviderSettings, saveCavemanConfig, saveCheckpoints, saveProjectCache, saveProjectMemory, saveRtkConfig, saveSessionMap, saveSessionVisibility, saveSnapshot, saveTaskState, saveWfConfig, saveWorkflow, scanGitFiles, scanProjects, scanWorkdirFiles, schedulePendingTurnSnapshot, scheduleProjectCacheBuild, scheduleSessionBackgroundInitialization, scheduledRuns, scheduledTasks, sdkStreamAdapter, selectCancelledInputTurns, selectRtkReleaseAsset, sendManualImText, sendWeChatChunks, sessionCatalogIds, sessionCatalogProjectKey, sessionCoordinator, sessionEventStorePath, sessionMapPath, sessionMirrorIds, sessionMirrorStorePath, sessionVisibilitySource, sessionVisibilityStorePath, sessions, setBuiltinResourceEnabled, setDeps, setPersistedMirror, setPersistedMirrors, setProjectMemoryEnabled, settlePending, shouldAutoTriggerWorkflow, shouldCaptureTurnCheckpoint, shouldDeferAutomaticQuery, shouldDeliverTurnEvent, shouldRouteMirror, shouldShowSession, shouldValidateProviderModel, shutdownGateway, shuttingDown, snapshotStorePath, spawn, spawnRtk, spawnSync, splitByBytes, startAdapter, startClaudeAgent, startCodexRelayProxy, startDeepSeekProxy, startDingTalkAdapter, startFeishuAdapter, startOpenCodeProxy, startStreamPump, startWeChatAdapter, statSync, stateRepositories, stateStoreDegradedReason, stopAdapter, stopCodexRelayProxy, stopDeepSeekProxy, stopOpenCodeProxy, stopSessionGeneration, stopWorkflow, stopWorkflowAgent, storageGateway, stripBridgeProviderSettings, submitTaskCommand, takeDeferredPrimaryResult, taskCommands, taskCompletionEventForClient, taskCoordinator, taskInputQueue, taskStateFileId, taskStateForClient, taskStateForError, taskStateForInconclusive, taskStateForSessionClient, taskStateForStop, taskStateFromCompletion, taskStateStorePath, taskStateWithNotificationIntents, taskWorkbench, taskWorkflowResultIdFromMessage, tokenMatches, transitionTaskCompletion, trustedValidationCommands, unlinkSync, updateProjectCache, updateSessionMap, updateTaskCompletion, updateTaskNotificationState, updateTaskState, upsertAdapterBinding, userPreferences, validateHooks, validateProviderModel, validateProviderUrl, validateWorkflowContent, verifyRtkAssetDigest, withTimeout, writeAdapterBindings, writeAdapterConfig, writeFileSync, writeJSON, wsPingTimer, wss} = deps
    const listProjectMemoryAsync = deps.listProjectMemoryAsync
    const rebuildProjectMemoryAsync = deps.rebuildProjectMemoryAsync
    const setProjectMemoryEnabledAsync = deps.setProjectMemoryEnabledAsync
    const saveProjectMemoryAsync = deps.saveProjectMemoryAsync
    const deleteProjectMemoryAsync = deps.deleteProjectMemoryAsync
    const candidateStore = deps.memoryCandidateStore || null
    const resolveHistoryTranscript = deps.resolveSessionTranscript
    const writeJson = (res, status, body) => {
        res.writeHead(status, {'Content-Type': 'application/json'})
        res.end(JSON.stringify(body))
    }
    const publicCandidate = row => {
        if (!row || typeof row !== 'object') return null
        return {
            candidateId: row.metadata?.candidateId || row.candidateId || null,
            projectKey: row.projectKey || null,
            taskId: row.metadata?.taskId || row.taskId || null,
            sourceKey: row.sourceKey || null,
            title: row.title || null,
            summary: row.body || row.summary || row.title || '',
            evidence: Array.isArray(row.metadata?.evidence) ? row.metadata.evidence.slice(0, 10) : Array.isArray(row.evidence) ? row.evidence.slice(0, 10) : [],
            scope: row.scope || 'project',
            status: row.status || 'candidate',
            createdAt: row.metadata?.createdAt || row.createdAt || null,
            updatedAt: row.updatedAt || null,
        }
    }
    const handleHistoryRequest = async ({req, res, url, projectHint = ''} = {}) => {
        const sessionId = url.pathname.match(/^\/api\/(?:sessions\/|projects\/[^/]+\/sessions\/)([^/]+)\/messages$/)?.[1]
        if (!sessionId || typeof resolveHistoryTranscript !== 'function') {
            writeJson(res, 503, {error: '历史解析器不可用', code: 'HISTORY_RESOLVER_UNAVAILABLE'})
            return
        }
        const identity = getAdapterIdentity(req)
        const location = resolveHistoryTranscript({sessionId, projectHint, workDir: identity?.workDir || ''})
        if (location.status === 'invalid') { writeJson(res, 400, {error: 'invalid project or session', code: 'HISTORY_REQUEST_INVALID'}); return }
        if (location.status === 'ambiguous') {
            log.error?.({sessionId: sessionId.slice(0, 8), matches: location.matches}, '会话 transcript 目录存在歧义')
            writeJson(res, 409, {error: '会话 transcript 目录存在歧义', code: 'HISTORY_LOCATION_AMBIGUOUS', matches: location.matches}); return
        }
        if (location.status !== 'found') { writeJson(res, 404, {error: '历史会话不存在', code: 'HISTORY_NOT_FOUND'}); return }
        const canonicalProjectKey = location.workDir && typeof encodeProjectName === 'function'
            ? encodeProjectName(location.workDir)
            : location.encodedDir
        if (identity
            && !adapterOwnsProject(identity, canonicalProjectKey)
            && !adapterOwnsProject(identity, location.encodedDir)) {
            log.warn?.({sessionId: sessionId.slice(0, 8), encodedDir: location.encodedDir}, '历史项目权限校验失败')
            writeJson(res, 403, {error: 'project ownership mismatch', code: 'HISTORY_PERMISSION_DENIED'}); return
        }
        try {
            const messages = parseSessionHistory(readFileSync(location.filePath, 'utf8'))
            writeJson(res, 200, {messages, encodedDir: location.encodedDir, workDir: location.workDir || null})
        } catch (error) {
            log.warn?.({err: error, sessionId: sessionId.slice(0, 8), encodedDir: location.encodedDir}, '读取会话历史失败')
            writeJson(res, 500, {error: '历史会话读取失败', code: 'HISTORY_READ_FAILED'})
        }
    }
    return async function handleMemoryRoute({req, res, url} = {}) {
    // ── GET /api/projects —— 扫描所有项目 ──
    // 功能说明: 扫描 ~/.claude-desktop-bridge/projects/ 目录，返回所有项目的列表（含 session 摘要和最后活跃时间）
    //   去重按 workDir 合并多 session 的同一项目
    // 关键数据流: GET → scanProjects() → 200 {projects: [{workDir, sessionCount, sessions, lastActive}]}
    if (req.method === 'GET' && url.pathname === '/api/projects') {
        // IM 配对身份由 HTTP 入口和 adapter 保证；项目目录用于选择目标，不能反向依赖当前 Session 绑定。
        const projects = await scanProjects();
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
        await handleHistoryRequest({req, res, url, projectHint: msm[1]})
        return
    }
    if (req.method === 'GET' && /^\/api\/sessions\/[^/]+\/messages$/.test(url.pathname)) {
        await handleHistoryRequest({req, res, url, projectHint: url.searchParams.get('project') || ''})
        return
    }

    // ── GET/PUT /api/projects/:encodedDir/memory-candidates —— 候选 Memory 审批 ──
    const candidatesM = url.pathname.match(/^\/api\/projects\/([^/]+)\/memory-candidates$/)
    if (req.method === 'GET' && candidatesM) {
        const ed = safeDecodeURIComponent(candidatesM[1])
        if (!ed || basename(ed) !== ed) { writeJson(res, 400, {error: 'invalid project', code: 'MEMORY_PROJECT_INVALID'}); return true }
        const identity = getAdapterIdentity(req)
        if (identity && !adapterOwnsProject(identity, ed)) { writeJson(res, 403, {error: 'project ownership mismatch'}); return true }
        if (!candidateStore?.listCandidates) { writeJson(res, 503, {error: 'memory candidate store unavailable', code: 'MEMORY_CANDIDATE_STORE_UNAVAILABLE'}); return true }
        try {
            const parsedLimit = Number(url.searchParams.get('limit'))
            const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(500, Math.trunc(parsedLimit))) : 100
            const candidates = await candidateStore.listCandidates({projectKey: ed, limit})
            writeJson(res, 200, {candidates: (Array.isArray(candidates) ? candidates : []).map(publicCandidate).filter(Boolean)})
        } catch (error) {
            log.warn({err: error, encodedDir: ed}, '读取 Memory candidate 失败')
            writeJson(res, 500, {error: '读取 Memory candidate 失败', code: 'MEMORY_CANDIDATE_LIST_FAILED'})
        }
        return true
    }
    const candidateM = url.pathname.match(/^\/api\/projects\/([^/]+)\/memory-candidates\/([^/]+)$/)
    if (req.method === 'PUT' && candidateM) {
        const ed = safeDecodeURIComponent(candidateM[1])
        const candidateId = safeDecodeURIComponent(candidateM[2])
        if (!ed || basename(ed) !== ed || !candidateId) { writeJson(res, 400, {error: 'invalid project or candidate', code: 'MEMORY_CANDIDATE_ARGUMENT_INVALID'}); return true }
        const identity = getAdapterIdentity(req)
        if (identity && !adapterOwnsProject(identity, ed)) { writeJson(res, 403, {error: 'project ownership mismatch'}); return true }
        if (!candidateStore?.approveMemoryCandidate || !candidateStore?.rejectMemoryCandidate) { writeJson(res, 503, {error: 'memory candidate store unavailable', code: 'MEMORY_CANDIDATE_STORE_UNAVAILABLE'}); return true }
        try {
            const body = await readBody(req)
            const action = String(body?.action || '').trim().toLowerCase()
            if (action === 'approve') {
                const actor = String(body?.actor || identity?.userId || '').trim()
                const result = await candidateStore.approveMemoryCandidate({candidateId, projectKey: ed, actor, sourceEvidence: body?.sourceEvidence, sourceKey: body?.sourceKey})
                writeJson(res, 200, {ok: true, candidate: publicCandidate(result)})
            } else if (action === 'reject') {
                const changed = await candidateStore.rejectMemoryCandidate({candidateId, projectKey: ed})
                writeJson(res, changed ? 200 : 404, changed ? {ok: true, candidateId, status: 'disabled'} : {error: 'Memory candidate 不存在', code: 'MEMORY_CANDIDATE_NOT_FOUND'})
            } else {
                writeJson(res, 400, {error: 'invalid candidate action', code: 'MEMORY_CANDIDATE_ACTION_INVALID'})
            }
        } catch (error) {
            const code = error?.code || 'MEMORY_CANDIDATE_UPDATE_FAILED'
            const status = code === 'MEMORY_CANDIDATE_NOT_FOUND' ? 404 : code === 'MEMORY_CANDIDATE_APPROVAL_REQUIRED' || code === 'MEMORY_CANDIDATE_ARGUMENT_INVALID' ? 400 : 500
            log.warn({err: error, encodedDir: ed, candidateId: candidateId.slice(0, 12)}, '更新 Memory candidate 失败')
            writeJson(res, status, {error: error?.message || '更新 Memory candidate 失败', code})
        }
        return true
    }

    const policyM = url.pathname.match(/^\/api\/projects\/([^/]+)\/memory\/policy$/)
    if (req.method === 'GET' && policyM) {
        const ed = safeDecodeURIComponent(policyM[1])
        if (!ed || basename(ed) !== ed) { writeJson(res, 400, {error: 'invalid project', code: 'MEMORY_PROJECT_INVALID'}); return true }
        const identity = getAdapterIdentity(req)
        if (identity && !adapterOwnsProject(identity, ed)) { writeJson(res, 403, {error: 'project ownership mismatch'}); return true }
        const memoryService = getMemoryService()
        if (!memoryService?.scalePolicyAsync) { writeJson(res, 503, {error: 'memory scale policy unavailable', code: 'MEMORY_SCALE_POLICY_UNAVAILABLE'}); return true }
        try {
            const recall = Number(url.searchParams.get('keywordRecall'))
            const injectionBytes = Number(url.searchParams.get('injectionBytes'))
            const policy = await memoryService.scalePolicyAsync({
                encodedDir: ed,
                keywordRecall: Number.isFinite(recall) ? recall : null,
                injectionBytes: Number.isFinite(injectionBytes) ? injectionBytes : 0,
            })
            writeJson(res, 200, {policy})
        } catch (error) {
            log.warn({err: error, encodedDir: ed}, '读取 Memory 规模策略失败')
            writeJson(res, 500, {error: error?.message || '读取 Memory 规模策略失败', code: 'MEMORY_SCALE_POLICY_FAILED'})
        }
        return true
    }

    // ── GET /api/projects/:encodedDir/memory —— 读取项目所有 memory 文件 ──
    const projMemM = url.pathname.match(/^\/api\/projects\/([^/]+)\/memory$/);
    if (req.method === 'GET' && projMemM) {
        const ed = safeDecodeURIComponent(projMemM[1]);
        const memoryService = getMemoryService()
        try {
            const result = await listProjectMemoryAsync({
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
        const memoryService = getMemoryService()
        try {
            const result = await rebuildProjectMemoryAsync({
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
        const memoryService = getMemoryService()
        const fn = safeDecodeURIComponent(projMemStatusM[2])
        const body = await readBody(req)
        try {
            const result = await setProjectMemoryEnabledAsync({encodedDir: ed, filename: fn, enabled: body.enabled, memoryService})
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
        const memoryService = getMemoryService()
        const fn = safeDecodeURIComponent(projMemFileM[2]);
        const body = await readBody(req);
        try {
            const result = await saveProjectMemoryAsync({
                encodedDir: ed,
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
        const memoryService = getMemoryService()
        const fn = safeDecodeURIComponent(projMemFileM[2]);
        try {
            const result = await deleteProjectMemoryAsync({bridgeHome: BRIDGE_HOME, encodedDir: ed, filename: fn, memoryService})
            res.writeHead(200)
            res.end(JSON.stringify({ok: true, ...result}))
        } catch (error) {
            res.writeHead(error.statusCode || 500)
            res.end(JSON.stringify({error: error.message, code: error.code || 'MEMORY_DELETE_FAILED'}))
        }
        return
    }


        return false
    }
}
