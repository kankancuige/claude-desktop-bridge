/** Gateway 启动副作用和运行服务初始化。 */
export function createStartupRuntime({
    bridgeHome,
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
    setState = () => {},
    setStorage = () => {},
    setTaskWorkbench = () => {},
    setCoordinatorVerification = () => {},
    setMemoryService = () => {},
    setAgentMailbox = () => {},
    setMemoryCandidateStore = () => {},
    setPitfallService = () => {},
    stateStore = null,
    getRepositories = () => ({}),
    initializeSecurePayloadKey,
    migrateAdapterCredentials,
    validateHooks,
    httpServer,
    port,
    requestGatewayShutdown,
    persistBridgeToken,
    bridgeTokenPath,
    adapterPlatforms = [],
    startAdapter,
    checkCavemanUpdate,
    checkRtkUpdate,
    resumeScheduledTasks,
    cleanupOrphanSessionDirs,
    initializeHttpRuntime,
    providerRuntime,
    logger = {info() {}, warn() {}, error() {}, fatal() {}},
} = {}) {
    if (!bridgeHome || typeof prepareBridgeHome !== 'function' || typeof readStorageConfigFile !== 'function'
        || typeof createStorageGateway !== 'function' || !httpServer) throw new TypeError('startup runtime dependencies are required')

    async function bootGateway() {
        const migration = prepareBridgeHome({bridgeHome})
        logger.info({bridgeHome, migrated: migration.copied?.length || 0, skipped: migration.skipped?.length || 0, alreadyComplete: migration.alreadyComplete}, 'Bridge 私有配置目录已准备')
        const storageConfig = readStorageConfigFile({bridgeHome}).config
        const storage = createStorageGateway({config: storageConfig, logger})
        setStorage(storage)
        await storage.connect()
        await ensurePostgresSchema(storage, {schema: storageConfig.schema})
        const state = await createPostgresStateCompat({gateway: storage, schema: storageConfig.schema, logger}).load()
        setState(state)
        storage.attachStateRepositories(state)
        logger.info({schema: storageConfig.schema, schemaVersion: state.schemaVersion}, 'PostgreSQL 状态存储已启用')
        if (state.available) {
            const pitfallService = createPitfallService({repository: getRepositories()?.pitfall})
            createPitfallAdmin({pitfallService})
            setPitfallService(pitfallService)
        }
        const taskWorkbench = createTaskWorkbenchRuntime({
            // Coordinator/Workbench 属于运行时组合根；PostgreSQL state 仅保留兼容读取。
            coordinator: stateStore?.taskCoordinator || state?.taskCoordinator,
            pitfallService: stateStore?.pitfallService || state?.pitfallService,
            persistReport: (report, snapshot) => {
                if (!state?.available || !snapshot?.plan?.workDir) return false
                return state.upsertExecutionReport({projectKey: sessionCatalogProjectKey(snapshot.plan.workDir), sessionId: snapshot.sessionId, report, updatedAt: Date.now()})
            },
        })
        setTaskWorkbench(taskWorkbench)
        const verification = createCoordinatorVerificationRuntime({
            taskCoordinator: stateStore?.taskCoordinator || state?.taskCoordinator,
            taskWorkbench,
            createVerificationAdapterRegistry,
            createCommandVerificationAdapter,
            createVerificationCampaignService,
            verificationRepository: () => getRepositories()?.workbench,
            projectKeyForWorkDir: sessionCatalogProjectKey,
            appendSessionEvent,
            logger,
        })
        setCoordinatorVerification(verification)
        setMemoryService(createMemoryService({bridgeHome, memoryRepository: getRepositories()?.memory, logger}))
        if (typeof createMemoryCandidateStore === 'function' && getRepositories()?.memory) {
            setMemoryCandidateStore(createMemoryCandidateStore({memoryRepository: getRepositories().memory}))
        }
        if (typeof createAgentMailbox === 'function' && getRepositories()?.coordination) {
            setAgentMailbox(createAgentMailbox({
                repository: getRepositories().coordination,
                onWake: event => logger.info({taskId: event.taskId, toAgent: event.toAgent}, 'Agent Mailbox 消息到达'),
            }))
        }
        const injected = await initializeSecurePayloadKey()
        if (typeof process.send === 'function' && !injected) logger.warn('未收到 Electron 安全存储密钥，将使用受限权限本地密钥')
        try { migrateAdapterCredentials() } catch (error) { logger.error({err: error}, 'IM 凭据加密迁移失败，适配器将保持停止') }
        validateHooks()
        if (typeof initializeHttpRuntime === 'function') initializeHttpRuntime()
        httpServer.on('error', error => { logger.fatal({err: error, port}, 'Gateway 监听失败'); requestGatewayShutdown('listen_error', 1) })
        httpServer.listen(port, '127.0.0.1', () => {
            try { persistBridgeToken() } catch (error) { logger.fatal({err: error, path: bridgeTokenPath}, 'Gateway token 写入失败，无法安全启动'); requestGatewayShutdown('token_persist_failed', 1); return }
            for (const platform of adapterPlatforms) startAdapter(platform)
            logger.info({port}, 'Gateway 已启动')
            checkCavemanUpdate().catch(error => logger.warn({err: error}, 'Caveman 版本检查异常'))
            checkRtkUpdate().catch(error => logger.warn({err: error}, 'RTK 版本检查异常'))
            resumeScheduledTasks()
            cleanupOrphanSessionDirs()
            const proxies = providerRuntime.startBootProxies()
            proxies.deepSeek.catch(error => logger.warn({err: error}, 'proxy boot 启动失败'))
            proxies.openCode.catch(error => logger.warn({err: error}, 'opencode proxy boot 启动失败'))
        })
    }
    return {bootGateway}
}
