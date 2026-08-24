import {join, dirname} from 'node:path'
import {removeSessionMapEntry, resolveMappedGatewaySessionId, updateSessionMap} from '../sessions/session-map-consistency.mjs'
import {markSessionVisible, removeSessionVisibility} from '../sessions/session-visibility.mjs'

/** Gateway/SDK 身份映射和可见性存储端口。 */
export function createSessionIdentityRuntime({
    bridgeHome,
    encodeProjectName,
    readJSON,
    writeJSON,
    readdirSync,
    statSync,
    loadSessionVisibility,
    ensureSessionCatalogIdentity = () => {},
    invalidateProjectsCache = () => {},
    logger = {warn() {}, debug() {}},
} = {}) {
    if (!bridgeHome || typeof encodeProjectName !== 'function') throw new TypeError('session identity dependencies are required')

    const sessionMapPath = workDir => join(bridgeHome, 'projects', encodeProjectName(workDir), 'bridge-session-map.json')
    const sessionVisibilityStorePath = workDir => join(bridgeHome, 'projects', encodeProjectName(workDir), 'bridge-session-visibility.json')

    function loadSessionMap(workDir) { return readJSON(sessionMapPath(workDir)) || {} }
    function saveSessionMap(workDir, map) {
        try { writeJSON(sessionMapPath(workDir), map); return true }
        catch (error) { logger.warn({err: error}, 'session-map 保存失败'); return false }
    }
    function saveSessionVisibility(workDir, state) {
        try { writeJSON(sessionVisibilityStorePath(workDir), state); return true }
        catch (error) { logger.warn({err: error, workDir}, 'Session 可见性白名单保存失败'); return false }
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
        const saved = saveSessionVisibility(workDir, removeSessionVisibility(current, {gatewaySessionId, sdkSessionId}))
        if (saved) invalidateProjectsCache()
        return saved
    }
    function removeVisibleSessionEverywhere(gatewaySessionId, sdkSessionId = null) {
        const projectsDir = join(bridgeHome, 'projects')
        try {
            for (const encodedDir of readdirSync(projectsDir)) {
                const projectDir = join(projectsDir, encodedDir)
                if (!statSync(projectDir).isDirectory()) continue
                const current = loadSessionVisibility(projectDir)
                const next = removeSessionVisibility(current, {gatewaySessionId, sdkSessionId})
                if (JSON.stringify(next) === JSON.stringify(current)) continue
                try { writeJSON(join(projectDir, 'bridge-session-visibility.json'), next) }
                catch (error) { logger.warn({err: error, projectDir}, '跨项目清理 Session 可见性失败') }
            }
        } catch (error) { logger.warn({err: error}, '扫描 Session 可见性文件失败') }
        invalidateProjectsCache()
    }
    function getProjectVisibility(workDir) { return loadSessionVisibility(dirname(sessionVisibilityStorePath(workDir))) }
    function persistSdkSessionId(workDir, gatewaySessionId, sdkSessionId) {
        const saved = saveSessionMap(workDir, updateSessionMap(loadSessionMap(workDir), gatewaySessionId, sdkSessionId))
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
    function lookupSdkSessionId(workDir, gatewaySessionId) { return loadSessionMap(workDir)[gatewaySessionId] || null }
    function lookupGatewaySessionId(workDir, sdkSessionId) { return resolveMappedGatewaySessionId(loadSessionMap(workDir), sdkSessionId) }

    return {
        sessionMapPath, loadSessionMap, saveSessionMap,
        sessionVisibilityStorePath, saveSessionVisibility, markVisibleSession,
        removeVisibleSession, removeVisibleSessionEverywhere, getProjectVisibility,
        persistSdkSessionId, removeSdkSessionId, lookupSdkSessionId, lookupGatewaySessionId,
    }
}
