import {createProviderConfigRoutes} from '../http/provider-config-routes.mjs'
import {createSessionMutationRoutes} from '../http/session-mutation-routes.mjs'
import {createSessionFileRoutes} from '../http/session-file-routes.mjs'
import {createAdapterConfigRoutes} from '../http/adapter-config-routes.mjs'
import {createMemoryRoutes} from '../http/memory-routes.mjs'
import {createWorkflowRoutes} from '../http/workflow-routes.mjs'
import {createWorkbenchRoutes} from '../http/workbench-routes.mjs'
import {createUsageRoutes} from '../http/usage-routes.mjs'
import {createHttpRequestHandler} from '../http/request-handler.mjs'

/**
 * HTTP 路由组合边界。
 *
 * 业务实现只提供依赖上下文；路由模块的集合、顺序和 HTTP 协议适配由
 * 本运行时统一拥有，避免 Gateway 主文件同时承担路由注册和业务逻辑。
 */
export function createHttpRuntime({routeContext, providerConfig = {}} = {}) {
    if (!routeContext || typeof routeContext !== 'object') throw new TypeError('routeContext is required')
    const providerConfigRoutes = createProviderConfigRoutes({
        dynamicCache: routeContext.dynamicCache,
        getLiveQuery: routeContext.getLiveQuery,
        withTimeout: routeContext.withTimeout,
        persistDynamicCache: routeContext.persistDynamicCache,
        loadCliSettings: routeContext.loadCliSettings,
        fetchProviderResponse: routeContext.fetchProviderResponse,
        validateProviderUrl: routeContext.validateProviderUrl,
        buildProviderModelsUrl: routeContext.buildProviderModelsUrl,
        buildProviderFallbackUrls: routeContext.buildProviderFallbackUrls,
        providers: routeContext.PROVIDERS,
        readBody: routeContext.readBody,
        log: routeContext.log,
        restoreSecretValue: routeContext.restoreSecretValue,
        ...providerConfig,
    })

    const configRoutes = routeContext.configRoutes || (async () => false)
    const sessionMutationRoutes = createSessionMutationRoutes(routeContext)
    const sessionFileRoutes = createSessionFileRoutes(routeContext)
    const adapterConfigRoutes = createAdapterConfigRoutes(routeContext)
    const memoryRoutes = createMemoryRoutes(routeContext)
    const workflowRoutes = createWorkflowRoutes(routeContext)
    const workbenchRoutes = createWorkbenchRoutes({
        version: routeContext.PKG_VERSION,
        getStorageHealth: routeContext.getStorageHealth,
        getState: routeContext.getState,
        getRepositories: routeContext.getRepositories,
        getPitfallAdmin: routeContext.getPitfallAdmin,
        getAiHealth: routeContext.getAiHealth,
        getDriftCandidates: routeContext.getDriftCandidates,
        resolveSessionLink: routeContext.resolveSessionLink,
        getSessionLinkResolver: routeContext.getSessionLinkResolver,
        decode: routeContext.safeDecodeURIComponent,
    })
    const usageRoutes = createUsageRoutes({
        getUsageStore: routeContext.getUsageStore,
        getSessions: routeContext.getSessions,
        getState: routeContext.getState,
    })
    const handleHttpRequest = createHttpRequestHandler({
        port: routeContext.PORT,
        allowTokenEndpoint: routeContext.ALLOW_TOKEN_ENDPOINT,
        bridgeToken: routeContext.BRIDGE_TOKEN,
        authenticateBridgeToken: routeContext.authenticateBridgeToken,
        getAdapterIdentity: routeContext.getAdapterIdentity,
        adapterRouteAllowed: routeContext.adapterRouteAllowed,
        adapterOwnsSession: routeContext.adapterOwnsSession,
        routes: [
            configRoutes,
            sessionMutationRoutes,
            sessionFileRoutes,
            routeContext.resourceConfigRoutes,
            providerConfigRoutes,
            adapterConfigRoutes,
            memoryRoutes,
            workflowRoutes,
            workbenchRoutes,
            usageRoutes,
        ],
        readBody: routeContext.readBody,
        logHttpRequest: routeContext.logHttpRequest,
        log: routeContext.log,
    })
    return {
        handleHttpRequest,
        routes: {configRoutes, sessionMutationRoutes, sessionFileRoutes, providerConfigRoutes, adapterConfigRoutes, memoryRoutes, workflowRoutes, workbenchRoutes, usageRoutes},
    }
}
