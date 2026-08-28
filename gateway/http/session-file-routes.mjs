/** Session 文件、快照、镜像和回退 HTTP 路由。 */
export function createSessionFileRoutes(deps = {}) {
    const getFocusedSessionId = deps.getFocusedSessionId
    const {ADAPTER_CONFIG_PATH, ADAPTER_PLATFORMS, ADAPTER_SESSIONS_PATH, ADAPTER_STARTERS, ADAPTER_TOKENS, ALLOW_TOKEN_ENDPOINT, BINARY_EXTS, BRIDGE_HOME, BRIDGE_PROVIDER_SETTINGS_PATH, BRIDGE_TOKEN, BRIDGE_TOKEN_PATH, BUILTIN_AGENTS, BUILTIN_AGENT_DEFINITIONS, BUILTIN_AGENT_TYPES, BUILTIN_COMMANDS, BUILTIN_MCP, BUILTIN_SKILLS, CAVEMAN_DEFAULT_CONFIG, CAVEMAN_SKILL_DIR, CAVEMAN_SKILL_FILE, CAVEMAN_VALID_LEVELS, CAVEMAN_VERSION_FILE, CHILD_ENV_KEYS, DELETED_SESSIONS_FILE, DYNAMIC_CACHE_FILE, IM_CUSTOM_COMMANDS, IM_SOURCES, MAX_OCR_CONCURRENT, MAX_REMOTE_TEXT_BYTES, MAX_RTK_ARCHIVE_BYTES, MAX_SCHEDULED_CONCURRENT, MAX_SCHEDULED_DURATION_MS, MAX_SESSION_INPUT_QUEUE, MAX_SNAP_FILES, MAX_SNAP_FILE_BYTES, MODEL, NUDGE_ACTIONS, PKG_VERSION, PORT, PROJECTS_CACHE_TTL, PROJECT_CACHE_IDLE_DELAY_MS, PROVIDERS, PushStream, RTK_CRITICAL_PATTERN, RTK_READONLY_CROSS, RTK_READONLY_PREFIXES, RTK_READONLY_UNIX, RTK_REJECT_RATIO, RTK_TIMEOUT, SCHEDULED_TASKS_FILE, SECURE_PAYLOAD_KEY_PATH, SNAP_EXCLUDE_DIRS, SessionEventJournal, UPLOAD_QUOTA_BYTES, UPLOAD_TTL_MS, VALID_MODEL_MODES, VALID_PERMISSION_MODES, VALID_THINKING_LEVELS, WF_CONFIG_FILE, WF_TIER_MAP, WORKFLOW_TRIGGERS, WS_PING_INTERVAL, WS_PING_TIMEOUT, WX_MARKER_RESERVE, WX_MAX_BYTES, WebSocketServer, __dirname, _deletedDirty, _deletedPersistRetryCount, _deletedPersistScheduled, _deletedSessionIds, _exe, _ocProxyStarting, _persistDynamicTimer, _projectsCache, _proxyStarting, _scanningProjects, _schedulePersistDeleted, acceptSessionInput, activeOcr, adapterConfigReadError, adapterOwnsFocusedSession, adapterOwnsProject, adapterOwnsSession, adapterRouteAllowed, advancePendingTurn, analyzeMessageForWorkflow, appendSessionEvent, applyContextProfile, applySkillRoute, applyTaskCompletionEffects, armStreamWatchdog, attachTaskWorkflow, authenticateBridgeToken, autoTriggerFinalReview, autoTriggerWorkflow, backupFile, basename, beginTurn, bootGateway, bridgeStateDb, broadcast, broadcastDesktop, broadcastTaskLifecycle, broadcastTurn, broadcastWorkflowEvent, buildAgentDescriptor, buildAgentToolLifecycleEvent, buildCacheInjectionText, buildCavemanSystemPrompt, buildChildProcessEnv, buildFileSnapshot, buildGitContext, buildGitSnapshot, buildIncompleteMirrorText, buildModelHandoffPrompt, buildProjectCache, buildProjectContext, buildProjectContinuationContext, buildProviderFallbackUrls, buildProviderModelsUrl, buildSessionStopResponse, buildSystemInitEvent, buildTaskPitfallReminder, buildWindowsRtkExtractArgs, buildWindowsRtkExtractEnv, builtinCache, cacheFilePath, calculateAutoCompactWindow, canResumeTask, cancelPendingSessionInputs, checkAiLayerHealth, checkCavemanUpdate, checkRtkUpdate, checkpointStorePath, classifyContextProfile, classifyTaskResult, classifyTranscriptFile, claudeAgentProvider, cleanupOrphanSessionDirs, cleanupSessionUploads, cleanupUploadDir, clearAdapterBindings, clearAdapterBindingsForSessions, clearAdapterPlatformState, clearPlatformEntries, clearStreamWatchdog, clearTaskWorkflowGate, closeSessionRuntime, closeSync, collectTranscriptProjectGroups, commitWorkflow, compactBoundaryToEvent, compareSemver, composeContinuationPrompt, computeLineDiff, configureSecurePayloadMasterKey, confirmHooks, consumePendingSessionInputOnResult, consumeTaskWorkflowResultTurn, contextUsageEvent, controlClients, convertSdkToWs, coordinatorPersistence, createAdapterConfigRoutes, createAgentRegistry, createCommandVerificationAdapter, createCoordinatorPersistence, createImProgressPolicy, createImProgressReporter, createLogger, createMemoryRoutes, createMemoryService, createModelUsageEvent, createPinnedLookup, createPitfallAdmin, createPitfallService, createPostgresStateCompat, createProviderConfigRoutes, createProviderRegistry, createResourceConfigRoutes, createRuntimeAgentRegistry, createSdkStreamAdapter, createServer, createSessionContextEnvelope, createSessionCoordinator, createSessionFileRoutes, createSessionMutationRoutes, createSessionRuntime, createStorageGateway, createTaskCommandService, createTaskCompletionState, createTaskCoordinator, createTaskInputQueue, createTaskLifecycleSnapshot, createTaskPlan, createTaskStatePatch, createTaskWorkbenchRuntime, createTaskWorkflowGate, createTurnIdentity, createUserPreferenceService, createVerificationAdapterRegistry, createVerificationCampaignService, createWorkflowRoutes, cron, cronJobs, crypto, currentFileScan, decideTask, decisionToResult, decodeProjectName, deferPrimaryResultForTaskWorkflow, deleteProjectMemory, deleteSession, deleteSessionFiles, deleteWorkflowFile, describeAttachment, destroyScheduledJob, detectRuleDrift, diffSnapshotVsCurrent, dirname, downloadAndReplaceCaveman, downloadAndReplaceRtk, dynamicCache, encodeProjectName, ensureBuiltinSkillsAvailable, ensurePostgresSchema, ensureSessionCatalogIdentity, execFileSync, execSync, executeScheduledTask, existsSync, extractBridgeProviderSettings, extractSemver, extractWebSocketToken, failPendingSessionInputs, fetchProviderResponse, fileURLToPath, filterDeletedSessions, finalizeCheckpoint, findGitBashDirs, findSessionJsonl, findSessionTranscript, finishImProgressReporters, finishScheduledRun, finishTaskWorkflowResultTurn, focusedSessionId, forkSession, getAdapterHook, getAdapterIdentity, getBuiltinResourceState, getClaudeExe, getCodexRelayProxyUrl, getGitHead, getLastModified, getLiveQuery, getOpenCodeProxyUrl, getPersistedMirrors, getProjectVisibility, getProxyUrl, getRtkDir, getRunState, getSessionRuntimeState, getSessionStopScope, getSessionWorkflowState, getSessionWorkflowStates, getTaskLifecycleSnapshot, getUploadDir, getWorkflow, handleNotificationStateChange, hasPendingTaskWorkflow, hasPersistedNotificationIntents, hasStoppableSessionWork, homedir, httpRequest, httpsRequest, imProgressPolicy, imProgressRecipients, imProgressReporterKey, imProgressReporters, initialSessionIdentity, initializeSecurePayloadKey, initializeTaskWorkbenchSession, invalidateProjectsCache, isAdapterSessionActive, isAgentTranscriptByContent, isAutoContinuationPrompt, isBinaryPath, isDirectoryPath, isExplorationAttempt, isImageAttachment, isInternalWorkflowResultText, isOpenCodeProxyRunning, isProxyConfiguredFor, isReadOnlyCommand, isSyntheticCompactSummary, isUserSessionSource, isValidSessionId, join, journalTaskState, labelForChoice, lcsLength, lineDiffStats, listAdapterBindings, listProjectMemory, listProjectSessions, listProjectTranscriptCandidates, listWorkflows, loadAdapterConfig, loadAgentDefinitions, loadBridgeProviderSettings, loadCavemanConfig, loadCheckpoints, loadCliSettings, loadCliSettingsForUpdate, loadEnv, loadProjectCache, loadProjectVisibilityWithMigration, loadRtkConfig, loadSessionMap, loadSessionVisibility, loadSnapshot, loadTaskState, loadWfConfig, locateRtk, log, logHttpRequest, looksLikeIncompleteTransportFailure, lookupGatewaySessionId, lookupModelInfo, lookupSdkSessionId, lstatSync, makeCanUseTool, makeQueryOptions, mapModel, mapThinkingLevel, markInternalInput, markSessionDeleted, markSessionVisible, markVisibleSession, maybeInjectGitContext, maybeInjectProjectCache, maybeMirror, maybeRefreshContextUsage, maybeUpdateProjectCache, memoryService, migrateAdapterConfig, migrateAdapterCredentials, migrateLegacySessionVisibility, mirrorSessionIds, mirrorStorePath, mkdirSync, normalizeAdapterBindings, normalizeBridgeProviderSettings, normalizeContextProfile, normalizeExplicitModel, normalizeReviewOutcome, normalizeWeChatBaseUrl, normalizeWorkDir, noteTaskWorkflowTerminal, notificationTaskId, openSessionEventJournal, openSync, overlayBridgeProviderSettings, parseContextWindow, parseDeepSeekBalance, parseFrontmatter, parseMeta, parseMultipart, parsePricingPrice, parseSessionHistory, parseShellArgs, parseTokenCount, pendingQRCodes, persistBridgeToken, persistDynamicCache, persistSdkSessionId, persistSessionCatalogSettings, persistSessionMirrors, persistTaskStateProjection, pitfallAdmin, pitfallService, platformEntryFilePath, prepareBridgeHome, prepareUploadDir, presetRunState, projectCacheBuilds, providerRegistry, publishVerificationInconclusive, query, queryHistory, readAdapterBindings, readAdapterConfig, readBody, readFetchBodyLimited, readFileHeadLines, readFileSync, readJSON, readNotificationSummary, readSessionCatalogSettings, readStorageConfigFile, readSync, readdirSync, rebuildProjectMemory, reconcilePersistedNotificationIntents, reconcileSessionCatalog, reconcileTaskNotificationIntents, recordProviderUsage, recoverTaskState, redactSecretMap, refreshContextUsage, registerScheduledJob, rejectWebSocketUpgrade, relative, removeAdapterBindings, removePersistedMirrors, removePersistedSessionMirrors, removeSdkSessionId, removeSessionArtifact, removeSessionMapEntry, removeSessionVisibility, removeVisibleSession, removeVisibleSessionEverywhere, renameSync, repairPersistedTaskState, reportImProgressEvent, reqCounter, requestCoordinatorCompletion, requestGatewayShutdown, requestPinnedProvider, requiredTaskNotificationPlatforms, requirementsForAgentStart, resolve, resolveAutoContinuation, resolveBalanceProvider, resolveContextReusePolicy, resolveFinalReviewPlan, resolveFromPkgDir, resolveMappedGatewaySessionId, resolvePrimaryStopTurnId, resolveProviderCapabilityProfile, resolveProviderRedirect, resolveProviderUrl, resolveRequiredNotificationPlatforms, resolveResumeModel, resolveRtkCommandArgs, resolveSafe, resolveSdkInputContent, resolveSessionCreateMode, resolveSessionResume, resolveTaskAgents, resolveTaskModelRoute, resolveTaskPhases, resolveTranscriptProjectWorkDir, resolveTurnModelRoute, resolveWorkflowFinalReviewTier, restartAdapter, restoreCoordinatorSnapshot, restoreSecretMap, restoreSecretValue, restoreSessionMirrors, resumeScheduledTasks, resumeWorkflow, resumeWorkflowAgent, rewindToCheckpoint, rmSync, rmdirSync, rollbackSessionInput, routeSkills, rtkPostToolUseHandler, runCoordinatorRootCauseAnalysis, runCoordinatorValidation, runWfScript, safeBasename, safeChildPath, safeDecodeURIComponent, sanitizeMcpServers, saveAdapterConfig, saveBridgeProviderSettings, saveCavemanConfig, saveCheckpoints, saveProjectCache, saveProjectMemory, saveRtkConfig, saveSessionMap, saveSessionVisibility, saveSnapshot, saveTaskState, saveWfConfig, saveWorkflow, scanGitFiles, scanProjects, scanWorkdirFiles, schedulePendingTurnSnapshot, scheduleProjectCacheBuild, scheduleSessionBackgroundInitialization, scheduledRuns, scheduledTasks, sdkStreamAdapter, selectCancelledInputTurns, selectRtkReleaseAsset, sendManualImText, sendWeChatChunks, sessionCatalogIds, sessionCatalogProjectKey, sessionCoordinator, sessionEventStorePath, sessionMapPath, sessionMirrorIds, sessionMirrorStorePath, sessionVisibilitySource, sessionVisibilityStorePath, sessions, setBuiltinResourceEnabled, setDeps, setPersistedMirror, setPersistedMirrors, setProjectMemoryEnabled, settlePending, shouldAutoTriggerWorkflow, shouldCaptureTurnCheckpoint, shouldDeferAutomaticQuery, shouldDeliverTurnEvent, shouldRouteMirror, shouldShowSession, shouldValidateProviderModel, shutdownGateway, shuttingDown, snapshotStorePath, spawn, spawnRtk, spawnSync, splitByBytes, startAdapter, startClaudeAgent, startCodexRelayProxy, startDeepSeekProxy, startDingTalkAdapter, startFeishuAdapter, startOpenCodeProxy, startStreamPump, startWeChatAdapter, statSync, stateRepositories, stateStoreDegradedReason, stopAdapter, stopCodexRelayProxy, stopDeepSeekProxy, stopOpenCodeProxy, stopSessionGeneration, stopWorkflow, stopWorkflowAgent, storageGateway, stripBridgeProviderSettings, submitTaskCommand, takeDeferredPrimaryResult, taskCommands, taskCompletionEventForClient, taskCoordinator, taskInputQueue, taskStateFileId, taskStateForClient, taskStateForError, taskStateForInconclusive, taskStateForSessionClient, taskStateForStop, taskStateFromCompletion, taskStateStorePath, taskStateWithNotificationIntents, taskWorkbench, taskWorkflowResultIdFromMessage, tokenMatches, transitionTaskCompletion, trustedValidationCommands, unlinkSync, updateProjectCache, updateSessionMap, updateTaskCompletion, updateTaskNotificationState, updateTaskState, upsertAdapterBinding, userPreferences, validateHooks, validateProviderModel, validateProviderUrl, validateWorkflowContent, verifyRtkAssetDigest, withTimeout, writeAdapterBindings, writeAdapterConfig, writeFileSync, writeJSON, wsPingTimer, wss} = deps
    return async function handleSessionFileRoute({req, res, url} = {}) {
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
        const focusedSessionId = getFocusedSessionId?.() || null
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


        return false
    }
}
