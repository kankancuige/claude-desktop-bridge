/** Workflow CRUD、执行、暂停恢复和 Agent 控制 HTTP 路由。 */
export function createWorkflowRoutes(deps = {}) {
    const {ADAPTER_CONFIG_PATH, ADAPTER_PLATFORMS, ADAPTER_SESSIONS_PATH, ADAPTER_STARTERS, ADAPTER_TOKENS, ALLOW_TOKEN_ENDPOINT, BINARY_EXTS, BRIDGE_HOME, BRIDGE_PROVIDER_SETTINGS_PATH, BRIDGE_TOKEN, BRIDGE_TOKEN_PATH, BUILTIN_AGENTS, BUILTIN_AGENT_DEFINITIONS, BUILTIN_AGENT_TYPES, BUILTIN_COMMANDS, BUILTIN_MCP, BUILTIN_SKILLS, CAVEMAN_DEFAULT_CONFIG, CAVEMAN_SKILL_DIR, CAVEMAN_SKILL_FILE, CAVEMAN_VALID_LEVELS, CAVEMAN_VERSION_FILE, CHILD_ENV_KEYS, DELETED_SESSIONS_FILE, DYNAMIC_CACHE_FILE, IM_CUSTOM_COMMANDS, IM_SOURCES, MAX_OCR_CONCURRENT, MAX_REMOTE_TEXT_BYTES, MAX_RTK_ARCHIVE_BYTES, MAX_SCHEDULED_CONCURRENT, MAX_SCHEDULED_DURATION_MS, MAX_SESSION_INPUT_QUEUE, MAX_SNAP_FILES, MAX_SNAP_FILE_BYTES, MODEL, NUDGE_ACTIONS, PKG_VERSION, PORT, PROJECTS_CACHE_TTL, PROJECT_CACHE_IDLE_DELAY_MS, PROVIDERS, PushStream, RTK_CRITICAL_PATTERN, RTK_READONLY_CROSS, RTK_READONLY_PREFIXES, RTK_READONLY_UNIX, RTK_REJECT_RATIO, RTK_TIMEOUT, SCHEDULED_TASKS_FILE, SECURE_PAYLOAD_KEY_PATH, SNAP_EXCLUDE_DIRS, SessionEventJournal, UPLOAD_QUOTA_BYTES, UPLOAD_TTL_MS, VALID_MODEL_MODES, VALID_PERMISSION_MODES, VALID_THINKING_LEVELS, WF_CONFIG_FILE, WF_TIER_MAP, WORKFLOW_TRIGGERS, WS_PING_INTERVAL, WS_PING_TIMEOUT, WX_MARKER_RESERVE, WX_MAX_BYTES, WebSocketServer, __dirname, _deletedDirty, _deletedPersistRetryCount, _deletedPersistScheduled, _deletedSessionIds, _exe, _ocProxyStarting, _persistDynamicTimer, _projectsCache, _proxyStarting, _scanningProjects, _schedulePersistDeleted, acceptSessionInput, activeOcr, adapterConfigReadError, adapterOwnsFocusedSession, adapterOwnsProject, adapterOwnsSession, adapterRouteAllowed, advancePendingTurn, analyzeMessageForWorkflow, appendSessionEvent, applyContextProfile, applySkillRoute, applyTaskCompletionEffects, armStreamWatchdog, attachTaskWorkflow, authenticateBridgeToken, autoTriggerFinalReview, autoTriggerWorkflow, backupFile, basename, beginTurn, bootGateway, bridgeStateDb, broadcast, broadcastDesktop, broadcastTaskLifecycle, broadcastTurn, broadcastWorkflowEvent, buildAgentDescriptor, buildAgentToolLifecycleEvent, buildCacheInjectionText, buildCavemanSystemPrompt, buildChildProcessEnv, buildFileSnapshot, buildGitContext, buildGitSnapshot, buildIncompleteMirrorText, buildModelHandoffPrompt, buildProjectCache, buildProjectContext, buildProjectContinuationContext, buildProviderFallbackUrls, buildProviderModelsUrl, buildSessionStopResponse, buildSystemInitEvent, buildTaskPitfallReminder, buildWindowsRtkExtractArgs, buildWindowsRtkExtractEnv, builtinCache, cacheFilePath, calculateAutoCompactWindow, canResumeTask, cancelPendingSessionInputs, checkAiLayerHealth, checkCavemanUpdate, checkRtkUpdate, checkpointStorePath, classifyContextProfile, classifyTaskResult, classifyTranscriptFile, claudeAgentProvider, cleanupOrphanSessionDirs, cleanupSessionUploads, cleanupUploadDir, clearAdapterBindings, clearAdapterBindingsForSessions, clearAdapterPlatformState, clearPlatformEntries, clearStreamWatchdog, clearTaskWorkflowGate, closeSessionRuntime, closeSync, collectTranscriptProjectGroups, commitWorkflow, compactBoundaryToEvent, compareSemver, composeContinuationPrompt, computeLineDiff, configureSecurePayloadMasterKey, confirmHooks, consumePendingSessionInputOnResult, consumeTaskWorkflowResultTurn, contextUsageEvent, controlClients, convertSdkToWs, coordinatorPersistence, createAdapterConfigRoutes, createAgentRegistry, createCommandVerificationAdapter, createCoordinatorPersistence, createImProgressPolicy, createImProgressReporter, createLogger, createMemoryRoutes, createMemoryService, createModelUsageEvent, createPinnedLookup, createPitfallAdmin, createPitfallService, createPostgresStateCompat, createProviderConfigRoutes, createProviderRegistry, createResourceConfigRoutes, createRuntimeAgentRegistry, createSdkStreamAdapter, createServer, createSessionContextEnvelope, createSessionCoordinator, createSessionFileRoutes, createSessionMutationRoutes, createSessionRuntime, createStorageGateway, createTaskCommandService, createTaskCompletionState, createTaskCoordinator, createTaskInputQueue, createTaskLifecycleSnapshot, createTaskPlan, createTaskStatePatch, createTaskWorkbenchRuntime, createTaskWorkflowGate, createTurnIdentity, createUserPreferenceService, createVerificationAdapterRegistry, createVerificationCampaignService, createWorkflowRoutes, cron, cronJobs, crypto, currentFileScan, decideTask, decisionToResult, decodeProjectName, deferPrimaryResultForTaskWorkflow, deleteProjectMemory, deleteSession, deleteSessionFiles, deleteWorkflowFile, describeAttachment, destroyScheduledJob, detectRuleDrift, diffSnapshotVsCurrent, dirname, downloadAndReplaceCaveman, downloadAndReplaceRtk, dynamicCache, encodeProjectName, ensureBuiltinSkillsAvailable, ensurePostgresSchema, ensureSessionCatalogIdentity, execFileSync, execSync, executeScheduledTask, existsSync, extractBridgeProviderSettings, extractSemver, extractWebSocketToken, failPendingSessionInputs, fetchProviderResponse, fileURLToPath, filterDeletedSessions, finalizeCheckpoint, findGitBashDirs, findSessionJsonl, findSessionTranscript, finishImProgressReporters, finishScheduledRun, finishTaskWorkflowResultTurn, focusedSessionId, forkSession, getAdapterHook, getAdapterIdentity, getBuiltinResourceState, getClaudeExe, getCodexRelayProxyUrl, getGitHead, getLastModified, getLiveQuery, getOpenCodeProxyUrl, getPersistedMirrors, getProjectVisibility, getProxyUrl, getRtkDir, getRunState, getSessionRuntimeState, getSessionStopScope, getSessionWorkflowState, getSessionWorkflowStates, getTaskLifecycleSnapshot, getUploadDir, getWorkflow, handleNotificationStateChange, hasPendingTaskWorkflow, hasPersistedNotificationIntents, hasStoppableSessionWork, homedir, httpRequest, httpsRequest, imProgressPolicy, imProgressRecipients, imProgressReporterKey, imProgressReporters, initialSessionIdentity, initializeSecurePayloadKey, initializeTaskWorkbenchSession, invalidateProjectsCache, isAdapterSessionActive, isAgentTranscriptByContent, isAutoContinuationPrompt, isBinaryPath, isDirectoryPath, isExplorationAttempt, isImageAttachment, isInternalWorkflowResultText, isOpenCodeProxyRunning, isProxyConfiguredFor, isReadOnlyCommand, isSyntheticCompactSummary, isUserSessionSource, isValidSessionId, join, journalTaskState, labelForChoice, lcsLength, lineDiffStats, listAdapterBindings, listProjectMemory, listProjectSessions, listProjectTranscriptCandidates, listWorkflows, loadAdapterConfig, loadAgentDefinitions, loadBridgeProviderSettings, loadCavemanConfig, loadCheckpoints, loadCliSettings, loadCliSettingsForUpdate, loadEnv, loadProjectCache, loadProjectVisibilityWithMigration, loadRtkConfig, loadSessionMap, loadSessionVisibility, loadSnapshot, loadTaskState, loadWfConfig, locateRtk, log, logHttpRequest, looksLikeIncompleteTransportFailure, lookupGatewaySessionId, lookupModelInfo, lookupSdkSessionId, lstatSync, makeCanUseTool, makeQueryOptions, mapModel, mapThinkingLevel, markInternalInput, markSessionDeleted, markSessionVisible, markVisibleSession, maybeInjectGitContext, maybeInjectProjectCache, maybeMirror, maybeRefreshContextUsage, maybeUpdateProjectCache, memoryService, migrateAdapterConfig, migrateAdapterCredentials, migrateLegacySessionVisibility, mirrorSessionIds, mirrorStorePath, mkdirSync, normalizeAdapterBindings, normalizeBridgeProviderSettings, normalizeContextProfile, normalizeExplicitModel, normalizeReviewOutcome, normalizeWeChatBaseUrl, normalizeWorkDir, noteTaskWorkflowTerminal, notificationTaskId, openSessionEventJournal, openSync, overlayBridgeProviderSettings, parseContextWindow, parseDeepSeekBalance, parseFrontmatter, parseMeta, parseMultipart, parsePricingPrice, parseSessionHistory, parseShellArgs, parseTokenCount, pendingQRCodes, persistBridgeToken, persistDynamicCache, persistSdkSessionId, persistSessionCatalogSettings, persistSessionMirrors, persistTaskStateProjection, pitfallAdmin, pitfallService, platformEntryFilePath, prepareBridgeHome, prepareUploadDir, presetRunState, projectCacheBuilds, providerRegistry, publishVerificationInconclusive, query, queryHistory, readAdapterBindings, readAdapterConfig, readBody, readFetchBodyLimited, readFileHeadLines, readFileSync, readJSON, readNotificationSummary, readSessionCatalogSettings, readStorageConfigFile, readSync, readdirSync, rebuildProjectMemory, reconcilePersistedNotificationIntents, reconcileSessionCatalog, reconcileTaskNotificationIntents, recordProviderUsage, recoverTaskState, redactSecretMap, refreshContextUsage, registerScheduledJob, rejectWebSocketUpgrade, relative, removeAdapterBindings, removePersistedMirrors, removePersistedSessionMirrors, removeSdkSessionId, removeSessionArtifact, removeSessionMapEntry, removeSessionVisibility, removeVisibleSession, removeVisibleSessionEverywhere, renameSync, repairPersistedTaskState, reportImProgressEvent, reqCounter, requestCoordinatorCompletion, requestGatewayShutdown, requestPinnedProvider, requiredTaskNotificationPlatforms, requirementsForAgentStart, resolve, resolveAutoContinuation, resolveBalanceProvider, resolveContextReusePolicy, resolveFinalReviewPlan, resolveFromPkgDir, resolveMappedGatewaySessionId, resolvePrimaryStopTurnId, resolveProviderCapabilityProfile, resolveProviderRedirect, resolveProviderUrl, resolveRequiredNotificationPlatforms, resolveResumeModel, resolveRtkCommandArgs, resolveSafe, resolveSdkInputContent, resolveSessionCreateMode, resolveSessionResume, resolveTaskAgents, resolveTaskModelRoute, resolveTaskPhases, resolveTranscriptProjectWorkDir, resolveTurnModelRoute, resolveWorkflowFinalReviewTier, restartAdapter, restoreCoordinatorSnapshot, restoreSecretMap, restoreSecretValue, restoreSessionMirrors, resumeScheduledTasks, resumeWorkflow, resumeWorkflowAgent, rewindToCheckpoint, rmSync, rmdirSync, rollbackSessionInput, routeSkills, rtkPostToolUseHandler, runCoordinatorRootCauseAnalysis, runCoordinatorValidation, runWfScript, safeBasename, safeChildPath, safeDecodeURIComponent, sanitizeMcpServers, saveAdapterConfig, saveBridgeProviderSettings, saveCavemanConfig, saveCheckpoints, saveProjectCache, saveProjectMemory, saveRtkConfig, saveSessionMap, saveSessionVisibility, saveSnapshot, saveTaskState, saveWfConfig, saveWorkflow, scanGitFiles, scanProjects, scanWorkdirFiles, schedulePendingTurnSnapshot, scheduleProjectCacheBuild, scheduleSessionBackgroundInitialization, scheduledRuns, scheduledTasks, sdkStreamAdapter, selectCancelledInputTurns, selectRtkReleaseAsset, sendManualImText, sendWeChatChunks, sessionCatalogIds, sessionCatalogProjectKey, sessionCoordinator, sessionEventStorePath, sessionMapPath, sessionMirrorIds, sessionMirrorStorePath, sessionVisibilitySource, sessionVisibilityStorePath, sessions, setBuiltinResourceEnabled, setDeps, setPersistedMirror, setPersistedMirrors, setProjectMemoryEnabled, settlePending, shouldAutoTriggerWorkflow, shouldCaptureTurnCheckpoint, shouldDeferAutomaticQuery, shouldDeliverTurnEvent, shouldRouteMirror, shouldShowSession, shouldValidateProviderModel, shutdownGateway, shuttingDown, snapshotStorePath, spawn, spawnRtk, spawnSync, splitByBytes, startAdapter, startAutoContinuation, startClaudeAgent, startCodexRelayProxy, startDeepSeekProxy, startDingTalkAdapter, startFeishuAdapter, startOpenCodeProxy, startStreamPump, startWeChatAdapter, statSync, stateRepositories, stateStoreDegradedReason, stopAdapter, stopCodexRelayProxy, stopDeepSeekProxy, stopOpenCodeProxy, stopSessionGeneration, stopWorkflow, stopWorkflowAgent, storageGateway, stripBridgeProviderSettings, submitTaskCommand, takeDeferredPrimaryResult, taskCommands, taskCompletionEventForClient, taskCoordinator, taskInputQueue, taskStateFileId, taskStateForClient, taskStateForError, taskStateForInconclusive, taskStateForSessionClient, taskStateForStop, taskStateFromCompletion, taskStateStorePath, taskStateWithNotificationIntents, taskWorkbench, taskWorkflowResultIdFromMessage, tokenMatches, transitionTaskCompletion, trustedValidationCommands, unlinkSync, updateProjectCache, updateSessionMap, updateTaskCompletion, updateTaskNotificationState, updateTaskState, upsertAdapterBinding, userPreferences, validateHooks, validateProviderModel, validateProviderUrl, validateWorkflowContent, verifyRtkAssetDigest, withTimeout, writeAdapterBindings, writeAdapterConfig, writeFileSync, writeJSON, wsPingTimer, wss} = deps
    const workflow = deps.workflowRuntime || {
        listWorkflows, getWorkflow, saveWorkflow, validateWorkflowContent, deleteWorkflow: deleteWorkflowFile,
        runWorkflow: runWfScript, queryHistory, getRunState, presetRunState, stopWorkflow, stopWorkflowAgent,
        resumeWorkflowAgent, resumeWorkflow, commitWorkflow,
    }
    return async function handleWorkflowRoute({req, res, url} = {}) {
    // ── Workflow 脚本 CRUD ( ~/.claude-desktop-bridge/workflows/*.mjs ) ──
    // GET  /api/workflows          → 列出所有脚本
    // GET  /api/workflows/:name    → 读取脚本内容
    // PUT  /api/workflows/:name    → 保存脚本
    // DELETE /api/workflows/:name → 删除脚本
    // POST /api/workflows/:name/run → 执行脚本
    // GET  /api/workflows/history → 查询执行历史
    if (url.pathname === '/api/workflows/history' && req.method === 'GET') {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200)
        const history = workflow.queryHistory(limit)
        res.writeHead(200)
        res.end(JSON.stringify({history}))
        return
    }
    // GET  /api/workflows/:name/state → 查询运行状态
    if (url.pathname === '/api/workflows' && req.method === 'GET') {
        const list = workflow.listWorkflows();
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
            if (!workflow.getWorkflow(name)) {
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
            workflow.presetRunState(name, runKey, sid)
            broadcastTaskLifecycle(sid)
            void workflow.runWorkflow(name, sid, {
                ...(body.args || {}),
                _runKey: runKey,
                _taskOwned: false,
                _permissionMode: sessions.get(sid)?.permissionMode || 'default',
            }).catch(e => {
                if (workflow.getRunState(runKey)?.status !== 'error') {
                    broadcast(sid, {type: 'workflow_error', workflowName: name, error: e.message})
                }
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
        const state = workflow.getRunState(safeDecodeURIComponent(wfStateM[1]))
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
                const r = await workflow.commitWorkflow(runKey)
                if (sid) broadcastTaskLifecycle(sid)
                res.writeHead(200)
                res.end(JSON.stringify({ok: true, name, ...r}))
            } catch (e) {
                res.writeHead(400)
                res.end(JSON.stringify({error: e.message}))
            }
            return
        }
        const ok = workflow.stopWorkflow(runKey)
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
            if (!workflow.getWorkflow(name)) {
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
            workflow.presetRunState(name, runKey, sid)
            broadcastTaskLifecycle(sid)
            const override = {}
            if (body.budgetMax != null) override.budgetMax = Number(body.budgetMax)
            override._permissionMode = sessions.get(sid)?.permissionMode || 'default'
            void workflow.resumeWorkflow(name, sid, override, runKey).catch(e => {
                if (workflow.getRunState(runKey)?.status !== 'error') {
                    broadcast(sid, {type: 'workflow_error', workflowName: name, error: e.message})
                }
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
        const state = workflow.getRunState(typeof body.workflowId === 'string' ? body.workflowId : wfName)
        if (!state) { res.writeHead(404); res.end(JSON.stringify({error: 'workflow 未运行'})); return }
        const wfId = state.wfId
        const ok = workflow.stopWorkflowAgent(wfId, agentLabel)
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
        const state = workflow.getRunState(typeof body.workflowId === 'string' ? body.workflowId : wfName)
        if (!state) { res.writeHead(404); res.end(JSON.stringify({error: 'workflow 未运行'})); return }
        const ok = workflow.resumeWorkflowAgent(state.wfId, agentLabel)
        res.writeHead(ok ? 200 : 404)
        res.end(JSON.stringify({ok, agentLabel}))
        return
    }
    const wfFileM = url.pathname.match(/^\/api\/workflows\/([^/]+)$/)
    if (wfFileM) {
        const name = safeDecodeURIComponent(wfFileM[1])
        if (req.method === 'GET') {
            const content = workflow.getWorkflow(name);
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
                workflow.validateWorkflowContent(body.content)
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
            workflow.saveWorkflow(name, body.content);
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
            workflow.deleteWorkflow(name);
            res.writeHead(200);
            res.end(JSON.stringify({ok: true}));
            return
        }
    }


        return false
    }
}
