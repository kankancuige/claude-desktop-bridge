/** 定时任务、IM Adapter、MCP 和余额/确认 HTTP 路由。 */
export function createAdapterConfigRoutes(deps = {}) {
    const getMemoryService = typeof deps.getMemoryService === 'function' ? deps.getMemoryService : () => deps.memoryService
    const getFocusedSessionId = deps.getFocusedSessionId
    const scheduledTaskStore = deps.scheduledTaskStore
    const getNotificationRepository = typeof deps.getNotificationRepository === 'function'
        ? deps.getNotificationRepository
        : () => null
    const {ADAPTER_CONFIG_PATH, ADAPTER_PLATFORMS, ADAPTER_SESSIONS_PATH, ADAPTER_STARTERS, ADAPTER_TOKENS, ALLOW_TOKEN_ENDPOINT, BINARY_EXTS, BRIDGE_HOME, BRIDGE_PROVIDER_SETTINGS_PATH, BRIDGE_TOKEN, BRIDGE_TOKEN_PATH, BUILTIN_AGENTS, BUILTIN_AGENT_DEFINITIONS, BUILTIN_AGENT_TYPES, BUILTIN_COMMANDS, BUILTIN_MCP, BUILTIN_SKILLS, CAVEMAN_DEFAULT_CONFIG, CAVEMAN_SKILL_DIR, CAVEMAN_SKILL_FILE, CAVEMAN_VALID_LEVELS, CAVEMAN_VERSION_FILE, CHILD_ENV_KEYS, DELETED_SESSIONS_FILE, DYNAMIC_CACHE_FILE, IM_CUSTOM_COMMANDS, IM_SOURCES, MAX_OCR_CONCURRENT, MAX_REMOTE_TEXT_BYTES, MAX_RTK_ARCHIVE_BYTES, MAX_SCHEDULED_CONCURRENT, MAX_SCHEDULED_DURATION_MS, MAX_SESSION_INPUT_QUEUE, MAX_SNAP_FILES, MAX_SNAP_FILE_BYTES, MODEL, NUDGE_ACTIONS, PKG_VERSION, PORT, PROJECTS_CACHE_TTL, PROJECT_CACHE_IDLE_DELAY_MS, PROVIDERS, PushStream, RTK_CRITICAL_PATTERN, RTK_READONLY_CROSS, RTK_READONLY_PREFIXES, RTK_READONLY_UNIX, RTK_REJECT_RATIO, RTK_TIMEOUT, SCHEDULED_TASKS_FILE, SECURE_PAYLOAD_KEY_PATH, SNAP_EXCLUDE_DIRS, STREAM_IDLE_TIMEOUT_MS, SessionEventJournal, UPLOAD_QUOTA_BYTES, UPLOAD_TTL_MS, VALID_MODEL_MODES, VALID_PERMISSION_MODES, VALID_THINKING_LEVELS, WF_CONFIG_FILE, WF_TIER_MAP, WORKFLOW_TRIGGERS, WS_PING_INTERVAL, WS_PING_TIMEOUT, WX_MARKER_RESERVE, WX_MAX_BYTES, WebSocketServer, __dirname, _deletedDirty, _deletedPersistRetryCount, _deletedPersistScheduled, _deletedSessionIds, _exe, _ocProxyStarting, _persistDynamicTimer, _projectsCache, _proxyStarting, _scanningProjects, _schedulePersistDeleted, acceptSessionInput, activeOcr, adapterConfigReadError, adapterOwnsFocusedSession, adapterOwnsProject, adapterOwnsSession, adapterRouteAllowed, advancePendingTurn, analyzeMessageForWorkflow, appendSessionEvent, applyContextProfile, applySkillRoute, applyTaskCompletionEffects, armStreamWatchdog, attachTaskWorkflow, authenticateBridgeToken, autoTriggerFinalReview, autoTriggerWorkflow, backupFile, basename, beginTurn, bootGateway, bridgeStateDb, broadcast, broadcastDesktop, broadcastTaskLifecycle, broadcastTurn, broadcastWorkflowEvent, buildAgentDescriptor, buildAgentToolLifecycleEvent, buildCacheInjectionText, buildCavemanSystemPrompt, buildChildProcessEnv, buildFileSnapshot, buildGitContext, buildGitSnapshot, buildIncompleteMirrorText, buildModelHandoffPrompt, buildProjectCache, buildProjectContext, buildProjectContinuationContext, buildProviderFallbackUrls, buildProviderModelsUrl, buildSessionStopResponse, buildSystemInitEvent, buildTaskPitfallReminder, buildWindowsRtkExtractArgs, buildWindowsRtkExtractEnv, builtinCache, cacheFilePath, calculateAutoCompactWindow, canResumeTask, cancelPendingSessionInputs, checkAiLayerHealth, checkCavemanUpdate, checkRtkUpdate, checkpointStorePath, classifyContextProfile, classifyTaskResult, classifyTranscriptFile, claudeAgentProvider, cleanupOrphanSessionDirs, cleanupSessionUploads, cleanupUploadDir, clearAdapterBindings, clearAdapterBindingsForSessions, clearAdapterPlatformState, clearPlatformEntries, clearStreamWatchdog, clearTaskWorkflowGate, closeSessionRuntime, closeSync, collectTranscriptProjectGroups, commitWorkflow, compactBoundaryToEvent, compareSemver, composeContinuationPrompt, computeLineDiff, configureSecurePayloadMasterKey, confirmHooks, consumePendingSessionInputOnResult, consumeTaskWorkflowResultTurn, contextUsageEvent, controlClients, convertSdkToWs, coordinatorPersistence, createAdapterConfigRoutes, createAgentRegistry, createCommandVerificationAdapter, createCoordinatorPersistence, createImProgressPolicy, createImProgressReporter, createLogger, createMemoryRoutes, createMemoryService, createModelUsageEvent, createPinnedLookup, createPitfallAdmin, createPitfallService, createPostgresStateCompat, createProviderConfigRoutes, createProviderRegistry, createResourceConfigRoutes, createRuntimeAgentRegistry, createSdkStreamAdapter, createServer, createSessionContextEnvelope, createSessionCoordinator, createSessionFileRoutes, createSessionMutationRoutes, createSessionRuntime, createStorageGateway, createTaskCommandService, createTaskCompletionState, createTaskCoordinator, createTaskInputQueue, createTaskLifecycleSnapshot, createTaskPlan, createTaskStatePatch, createTaskWorkbenchRuntime, createTaskWorkflowGate, createTurnIdentity, createUserPreferenceService, createVerificationAdapterRegistry, createVerificationCampaignService, createWorkflowRoutes, cron, cronJobs, crypto, currentFileScan, decideTask, decisionToResult, decodeProjectName, deferPrimaryResultForTaskWorkflow, deleteProjectMemory, deleteSession, deleteSessionFiles, deleteWorkflowFile, describeAttachment, destroyScheduledJob, detectRuleDrift, diffSnapshotVsCurrent, dirname, downloadAndReplaceCaveman, downloadAndReplaceRtk, dynamicCache, encodeProjectName, ensureBuiltinSkillsAvailable, ensurePostgresSchema, ensureSessionCatalogIdentity, execFileSync, execSync, executeScheduledTask, existsSync, extractBridgeProviderSettings, extractSemver, extractWebSocketToken, failPendingSessionInputs, fetchProviderResponse, fileURLToPath, filterDeletedSessions, finalizeCheckpoint, findGitBashDirs, findSessionJsonl, findSessionTranscript, finishImProgressReporters, finishScheduledRun, finishTaskWorkflowResultTurn, focusedSessionId, forkSession, getAdapterHook, getAdapterIdentity, getBuiltinResourceState, getClaudeExe, getCodexRelayProxyUrl, getGitHead, getLastModified, getLiveQuery, getOpenCodeProxyUrl, getPersistedMirrors, getProjectVisibility, getProxyUrl, getRtkDir, getRunState, getSessionRuntimeState, getSessionStopScope, getSessionWorkflowState, getSessionWorkflowStates, getTaskLifecycleSnapshot, getUploadDir, getWorkflow, handleNotificationStateChange, hasPendingTaskWorkflow, hasPersistedNotificationIntents, hasStoppableSessionWork, homedir, httpRequest, httpsRequest, imProgressPolicy, imProgressRecipients, imProgressReporterKey, imProgressReporters, initialSessionIdentity, initializeSecurePayloadKey, initializeTaskWorkbenchSession, invalidateProjectsCache, isAdapterSessionActive, isAgentTranscriptByContent, isAutoContinuationPrompt, isBinaryPath, isDirectoryPath, isExplorationAttempt, isImageAttachment, isInternalWorkflowResultText, isOpenCodeProxyRunning, isProxyConfiguredFor, isReadOnlyCommand, isSyntheticCompactSummary, isUserSessionSource, isValidSessionId, join, journalTaskState, labelForChoice, lcsLength, lineDiffStats, listAdapterBindings, listProjectMemory, listProjectSessions, listProjectTranscriptCandidates, listWorkflows, loadAdapterConfig, loadAgentDefinitions, loadBridgeProviderSettings, loadCavemanConfig, loadCheckpoints, loadCliSettings, loadCliSettingsForUpdate, loadEnv, loadProjectCache, loadProjectVisibilityWithMigration, loadRtkConfig, loadSessionMap, loadSessionVisibility, loadSnapshot, loadTaskState, loadWfConfig, locateRtk, log, logHttpRequest, looksLikeIncompleteTransportFailure, lookupGatewaySessionId, lookupModelInfo, lookupSdkSessionId, lstatSync, makeCanUseTool, makeQueryOptions, mapModel, mapThinkingLevel, markInternalInput, markSessionDeleted, markSessionVisible, markVisibleSession, maybeInjectGitContext, maybeInjectProjectCache, maybeMirror, maybeRefreshContextUsage, maybeUpdateProjectCache, memoryService, migrateAdapterConfig, migrateAdapterCredentials, migrateLegacySessionVisibility, mirrorSessionIds, mirrorStorePath, mkdirSync, normalizeAdapterBindings, normalizeBridgeProviderSettings, normalizeContextProfile, normalizeExplicitModel, normalizeReviewOutcome, normalizeWeChatBaseUrl, normalizeWorkDir, noteTaskWorkflowTerminal, notificationTaskId, openSessionEventJournal, openSync, overlayBridgeProviderSettings, parseContextWindow, parseDeepSeekBalance, parseFrontmatter, parseMeta, parseMultipart, parsePricingPrice, parseSessionHistory, parseShellArgs, parseTokenCount, pendingQRCodes, persistBridgeToken, persistDynamicCache, persistSdkSessionId, persistSessionCatalogSettings, persistSessionMirrors, persistTaskStateProjection, pitfallAdmin, pitfallService, platformEntryFilePath, prepareBridgeHome, prepareUploadDir, presetRunState, projectCacheBuilds, providerRegistry, publishVerificationInconclusive, query, queryHistory, readAdapterBindings, readAdapterConfig, readBody, readFetchBodyLimited, readFileHeadLines, readFileSync, readJSON, readNotificationSummary, readSessionCatalogSettings, readStorageConfigFile, readSync, readdirSync, rebuildProjectMemory, reconcilePersistedNotificationIntents, reconcileSessionCatalog, reconcileTaskNotificationIntents, recordProviderUsage, recoverTaskState, redactSecretMap, refreshContextUsage, registerScheduledJob, rejectWebSocketUpgrade, relative, removeAdapterBindings, removePersistedMirrors, removePersistedSessionMirrors, removeSdkSessionId, removeSessionArtifact, removeSessionMapEntry, removeSessionVisibility, removeVisibleSession, removeVisibleSessionEverywhere, renameSync, repairPersistedTaskState, reportImProgressEvent, reqCounter, requestCoordinatorCompletion, requestGatewayShutdown, requestPinnedProvider, requiredTaskNotificationPlatforms, requirementsForAgentStart, resolve, resolveAutoContinuation, resolveBalanceProvider, resolveContextReusePolicy, resolveFinalReviewPlan, resolveFromPkgDir, resolveMappedGatewaySessionId, resolvePrimaryStopTurnId, resolveProviderCapabilityProfile, resolveProviderRedirect, resolveProviderUrl, resolveRequiredNotificationPlatforms, resolveResumeModel, resolveRtkCommandArgs, resolveSafe, resolveSdkInputContent, resolveSessionCreateMode, resolveSessionResume, resolveTaskAgents, resolveTaskModelRoute, resolveTaskPhases, resolveTranscriptProjectWorkDir, resolveTurnModelRoute, resolveWorkflowFinalReviewTier, restartAdapter, restoreCoordinatorSnapshot, restoreSecretMap, restoreSecretValue, restoreSessionMirrors, resumeScheduledTasks, resumeWorkflow, resumeWorkflowAgent, rewindToCheckpoint, rmSync, rmdirSync, rollbackSessionInput, routeSkills, rtkPostToolUseHandler, runCoordinatorRootCauseAnalysis, runCoordinatorValidation, runWfScript, safeBasename, safeChildPath, safeDecodeURIComponent, sanitizeMcpServers, saveAdapterConfig, saveBridgeProviderSettings, saveCavemanConfig, saveCheckpoints, saveProjectCache, saveProjectMemory, saveRtkConfig, saveSessionMap, saveSessionVisibility, saveSnapshot, saveTaskState, saveWfConfig, saveWorkflow, scanGitFiles, scanProjects, scanWorkdirFiles, schedulePendingTurnSnapshot, scheduleProjectCacheBuild, scheduleSessionBackgroundInitialization, scheduledRuns, scheduledTasks, sdkStreamAdapter, selectCancelledInputTurns, selectRtkReleaseAsset, sendManualImText, sendWeChatChunks, sessionCatalogIds, sessionCatalogProjectKey, sessionCoordinator, sessionEventStorePath, sessionMapPath, sessionMirrorIds, sessionMirrorStorePath, sessionVisibilitySource, sessionVisibilityStorePath, sessions, setBuiltinResourceEnabled, setDeps, setPersistedMirror, setPersistedMirrors, setProjectMemoryEnabled, settlePending, shouldAutoTriggerWorkflow, shouldCaptureTurnCheckpoint, shouldDeferAutomaticQuery, shouldDeliverTurnEvent, shouldRouteMirror, shouldShowSession, shouldValidateProviderModel, shutdownGateway, shuttingDown, snapshotStorePath, spawn, spawnRtk, spawnSync, splitByBytes, startAdapter, startAutoContinuation, startClaudeAgent, startCodexRelayProxy, startDeepSeekProxy, startDingTalkAdapter, startFeishuAdapter, startOpenCodeProxy, startStreamPump, startWeChatAdapter, statSync, stateRepositories, stateStoreDegradedReason, stopAdapter, stopCodexRelayProxy, stopDeepSeekProxy, stopOpenCodeProxy, stopSessionGeneration, stopWorkflow, stopWorkflowAgent, storageGateway, stripBridgeProviderSettings, submitTaskCommand, takeDeferredPrimaryResult, taskCommands, taskCompletionEventForClient, taskCoordinator, taskInputQueue, taskStateFileId, taskStateForClient, taskStateForError, taskStateForInconclusive, taskStateForSessionClient, taskStateForStop, taskStateFromCompletion, taskStateStorePath, taskStateWithNotificationIntents, taskWorkbench, taskWorkflowResultIdFromMessage, tokenMatches, transitionTaskCompletion, trustedValidationCommands, unlinkSync, updateProjectCache, updateSessionMap, updateTaskCompletion, updateTaskNotificationState, updateTaskState, upsertAdapterBinding, userPreferences, validateHooks, validateProviderModel, validateProviderUrl, validateWorkflowContent, verifyRtkAssetDigest, withTimeout, writeAdapterBindings, writeAdapterConfig, writeFileSync, writeJSON, wsPingTimer, wss} = deps
    return async function handleAdapterConfigRoute({req, res, url} = {}) {
    // GET /api/config/scheduled-tasks
    if (req.method === 'GET' && url.pathname === '/api/config/scheduled-tasks') {
        const list = Object.entries(scheduledTaskStore?.list?.() || {}).map(([id, t]) => ({
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
        const nextTask = {
            cron: b.cron, prompt: b.prompt, workDir: b.workDir,
            model: typeof b.model === 'string' && b.model.length <= 256 ? (b.model || MODEL) : MODEL,
            permissionMode, maxTurns, enabled: b.enabled !== false,
        }
        try {
            scheduledTaskStore.upsert(id, nextTask)
            if (nextTask.enabled) registerScheduledJob(id, b.cron)
        } catch (error) {
            destroyScheduledJob(id)
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
        const currentTask = scheduledTaskStore.get(id)
        if (!currentTask) { res.writeHead(404); res.end(JSON.stringify({error: 'not found'})); return }
        const previousTask = {...currentTask}
        const nextTask = {...currentTask}
        const b = await readBody(req)
        if (b.cron !== undefined) {
            if (typeof b.cron !== 'string' || b.cron.length > 128 || !cron.validate(b.cron)) { res.writeHead(400); res.end(JSON.stringify({error: 'invalid cron'})); return }
            nextTask.cron = b.cron
        }
        if (b.prompt !== undefined) {
            if (typeof b.prompt !== 'string' || !b.prompt.trim() || b.prompt.length > 20_000) { res.writeHead(400); res.end(JSON.stringify({error: 'invalid prompt'})); return }
            nextTask.prompt = b.prompt
        }
        if (b.workDir !== undefined) {
            if (!isDirectoryPath(b.workDir)) { res.writeHead(400); res.end(JSON.stringify({error: 'invalid workDir'})); return }
            nextTask.workDir = b.workDir
        }
        if (b.model !== undefined) {
            if (typeof b.model !== 'string' || b.model.length > 256) { res.writeHead(400); res.end(JSON.stringify({error: 'invalid model'})); return }
            nextTask.model = b.model
        }
        if (b.permissionMode !== undefined) {
            if (!['default', 'acceptEdits', 'plan', 'bypassPermissions'].includes(b.permissionMode)) { res.writeHead(400); res.end(JSON.stringify({error: 'invalid permissionMode'})); return }
            nextTask.permissionMode = b.permissionMode
        }
        if (b.maxTurns !== undefined) nextTask.maxTurns = Math.min(100, Math.max(1, Number(b.maxTurns) || 20))
        if (b.enabled !== undefined) nextTask.enabled = !!b.enabled
        try {
            scheduledTaskStore.upsert(id, nextTask)
            if (nextTask.enabled) registerScheduledJob(id, nextTask.cron)
            else destroyScheduledJob(id)
        } catch (error) {
            scheduledTaskStore.upsert(id, previousTask)
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
        const previousTask = scheduledTaskStore.get(id)
        if (!previousTask) { res.writeHead(404); res.end(JSON.stringify({error: 'not found'})); return }
        destroyScheduledJob(id)
        try {
            scheduledTaskStore.remove(id)
        } catch (error) {
            if (previousTask) {
                scheduledTaskStore.upsert(id, previousTask)
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
        const task = scheduledTaskStore.get(id)
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
            return getNotificationRepository()?.summarize?.({platform: p})
                || {pending: 0, failed: 0, dead: 0, sent: 0}
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
        const builtinMcpState = new Map(getBuiltinResourceState({bridgeHome: BRIDGE_HOME})
            .filter(item => item.type === 'mcp').map(item => [item.id, item]))
        const pj = join(BRIDGE_HOME, 'plugins', 'installed_plugins.json')
        const pm = new Map()
        for (const [k, v] of Object.entries(BUILTIN_MCP)) {
            pm.set(k, {name: k, version: v.version, scope: v.scope, enabled: builtinMcpState.get(k)?.enabled !== false, required: builtinMcpState.get(k)?.required === true, source: 'builtin'})
        }
        try {
            const d = readJSON(pj)
            if (d?.plugins) {
                for (const [k, vs] of Object.entries(d.plugins)) {
                    for (const v of vs) {
                        const src = v.scope === 'user' || v.scope === 'project' ? 'custom' : 'builtin'
                    pm.set(k, {name: k, version: v.version, scope: v.scope, enabled: src === 'builtin'
                        ? builtinMcpState.get(k)?.enabled !== false
                        : !disabledList.includes(k), required: src === 'builtin' && builtinMcpState.get(k)?.required === true, source: src})
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

    // 主动消息必须经过已运行适配器，保留配对校验、outbox、重试和平台协议实现。
    if (req.method === 'POST' && url.pathname === '/api/wechat/send') {
        try {
            const {userId, text} = await readBody(req);
            if (!userId || !text) {
                res.writeHead(400);
                res.end(JSON.stringify({error: 'userId and text required'}));
                return
            }
            const delivery = await sendManualImText({
                hook: getAdapterHook('wechat'),
                platform: 'wechat',
                userId,
                text,
                notificationId: `manual-wechat-${Date.now()}`,
            })
            if (delivery.error === 'adapter_unavailable') {
                res.writeHead(503)
                res.end(JSON.stringify({error: 'wechat adapter unavailable'}))
                return
            }
            res.writeHead(delivery.sent ? 200 : 202)
            res.end(JSON.stringify(delivery))
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

    // ── GET /api/config/memory-summary —— PostgreSQL 项目 Memory 摘要 ──
    // 功能说明: 以 PostgreSQL content_documents 的 Memory 索引为唯一数据源；
    //          本地 memory/*.md 仅作为兼容迁移文件，不参与项目 Memory 发现。
    // 关键数据流: GET → 遍历项目 → memoryService.listAsync() → 200 {mode:'postgres', projects:[...]}
    if (req.method === 'GET' && url.pathname === '/api/config/memory-summary') {
        const bp = join(BRIDGE_HOME, 'projects');
        const rs = [];
        try {
            for (const ed of readdirSync(bp)) {
                let jls = readdirSync(join(bp, ed)).filter(f => f.endsWith('.jsonl') && !f.startsWith('.trash-') && !f.startsWith('agent-') && !f.startsWith('wf-agent-'));
                jls = jls.filter(f => !isAgentTranscriptByContent(join(bp, ed, f)));
                const service = getMemoryService()
                const rows = typeof service?.listAsync === 'function'
                    ? await service.listAsync({encodedDir: ed, limit: 500})
                    : [];
                if (!jls.length && !rows.length) continue;
                let wd = decodeProjectName(ed) || ed;
                try {
                    const c = jls.length ? readFileSync(join(bp, ed, jls[0]), 'utf8') : '';
                    const cm = c.match(/"cwd":\s*"([^"]+)"/);
                    if (cm) wd = cm[1].replace(/\\/g, '/')
                } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
                rs.push({
                    workDir: wd,
                    encodedDir: ed,
                    fileCount: rows.length,
                    mode: 'postgres',
                })
            }
        } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }
        ;rs.sort((a, b) => b.fileCount - a.fileCount);
        res.writeHead(200);
        res.end(JSON.stringify({mode: 'postgres', projects: rs}));
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
        const focusedSessionId = getFocusedSessionId?.() || null
        const ownedSession = focusedSessionId ? sessions.get(focusedSessionId) : null
        const ownedId = ownedSession?.lastSessionId || binding.sessionId
        const owned = projectSessions.filter(item => item.id === ownedId)
        res.writeHead(200); res.end(JSON.stringify({ok: true, label: b.label, sessions: owned.map(s => ({id: s.id, title: s.title}))})); return
    }


        return false
    }
}
