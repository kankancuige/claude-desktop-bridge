import {readFileSync, renameSync, unlinkSync} from 'node:fs'
import {join} from 'node:path'
import {listAdapterBindings, normalizeAdapterBindings, removeAdapterBindings} from '../im/adapter-bindings.mjs'
import {migrateAdapterConfig, readAdapterConfig, writeAdapterConfig} from '../im/adapter-config.mjs'

/** IM 配置与 Session 绑定运行时。适配器生命周期由 IM Runtime 持有，这里只拥有持久化和归属判断。 */
export function createAdapterConfigRuntime({
    bridgeHome,
    adapterConfigPath = join(bridgeHome, 'adapters.json'),
    adapterSessionsPath = join(bridgeHome, 'adapter-sessions.json'),
    securePayloadKeyPath = join(bridgeHome, 'bridge-store-key'),
    adapterPlatforms = ['wechat', 'feishu', 'dingtalk'],
    readJSON,
    writeJSON,
    existsSync,
    renameSyncImpl = renameSync,
    readFileSyncImpl = readFileSync,
    readAdapterConfigImpl = readAdapterConfig,
    writeAdapterConfigImpl = writeAdapterConfig,
    migrateAdapterConfigImpl = migrateAdapterConfig,
    normalizeAdapterBindingsImpl = normalizeAdapterBindings,
    listAdapterBindingsImpl = listAdapterBindings,
    removeAdapterBindingsImpl = removeAdapterBindings,
    sessions = new Map(),
    getFocusedSessionId = () => null,
    encodeProjectName = value => value,
    logger = {error() {}, warn() {}, debug() {}, info() {}},
    normalizeWeChatBaseUrl = value => value,
    unlinkSync,
} = {}) {
    if (!bridgeHome || typeof bridgeHome !== 'string') throw new TypeError('bridgeHome is required')
    if (typeof readJSON !== 'function' || typeof writeJSON !== 'function') throw new TypeError('JSON storage dependencies are required')

    let adapterConfigReadError = null

    function loadAdapterConfig({strict = false} = {}) {
        try {
            const config = readAdapterConfigImpl(adapterConfigPath, {keyPath: securePayloadKeyPath})
            adapterConfigReadError = null
            return config
        } catch (error) {
            adapterConfigReadError = String(error?.message || error)
            if (strict) throw error
            logger.error({err: error}, 'IM 加密配置读取失败')
            return {}
        }
    }

    function saveAdapterConfig(config) {
        writeAdapterConfigImpl(adapterConfigPath, config, {keyPath: securePayloadKeyPath})
        adapterConfigReadError = null
    }

    function migrateAdapterCredentials() {
        let config = {}
        if (existsSync(adapterConfigPath)) {
            const result = migrateAdapterConfigImpl(adapterConfigPath, {keyPath: securePayloadKeyPath})
            config = result.config
            if (result.migrated) logger.info('IM 凭据已从明文配置迁移为加密存储')
        }
        const legacyWechatPath = join(bridgeHome, 'channels', 'wechat', 'default', 'account.json')
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
                logger.info('微信旧版账号凭据已迁移为加密存储')
            }
            if (config.wechat?.botToken) {
                try { unlinkSync(legacyWechatPath) } catch (error) { logger.warn({err: error}, '微信旧版明文账号文件清理失败') }
            }
        }
        return config
    }

    function readAdapterBindings() {
        if (!existsSync(adapterSessionsPath)) return {}
        try {
            return normalizeAdapterBindingsImpl(JSON.parse(readFileSyncImpl(adapterSessionsPath, 'utf8')), adapterPlatforms)
        } catch (error) {
            const corruptPath = `${adapterSessionsPath}.corrupt-${Date.now()}`
            try {
                renameSyncImpl(adapterSessionsPath, corruptPath)
                logger.error({err: error, corruptPath}, 'IM Session 绑定文件损坏，已隔离并重新建立')
                return {}
            } catch (renameError) {
                throw new AggregateError([error, renameError], 'IM Session 绑定文件损坏且无法隔离')
            }
        }
    }

    function writeAdapterBindings(bindings) {
        writeJSON(adapterSessionsPath, normalizeAdapterBindingsImpl(bindings, adapterPlatforms))
    }

    function isAdapterSessionActive(sessionId) {
        if (sessions.has(sessionId)) return true
        for (const session of sessions.values()) if (session.lastSessionId === sessionId) return true
        return false
    }

    function clearAdapterBindings(predicate) {
        const result = removeAdapterBindingsImpl(readAdapterBindings(), predicate, adapterPlatforms)
        if (result.deleted > 0) writeAdapterBindings(result.bindings)
        return result.deleted
    }

    function clearAdapterBindingsForSessions(...sessionIds) {
        const ids = new Set(sessionIds.filter(Boolean).map(String))
        return ids.size ? clearAdapterBindings(binding => ids.has(binding.sessionId)) : 0
    }

    function readAdapterBinding(identity) {
        if (!identity?.source || !identity?.userId) return null
        return readAdapterBindings()[`${identity.source}:${identity.userId}`] || null
    }

    function adapterOwnsSession(source, userId, sessionId) {
        const binding = readAdapterBindings()[`${source}:${userId}`]
        return binding?.platform === source && binding?.userId === userId && binding?.sessionId === sessionId
    }

    function adapterOwnsFocusedSession(identity) {
        const focusedSessionId = getFocusedSessionId()
        return !!identity && !!focusedSessionId && adapterOwnsSession(identity.source, identity.userId, focusedSessionId)
    }

    function adapterOwnsProject(identity, encodedDir) {
        if (!identity || typeof encodedDir !== 'string') return false
        const binding = readAdapterBinding(identity)
        return !!binding && encodeProjectName(binding.workDir) === encodedDir
    }

    function listBindings() {
        return listAdapterBindingsImpl(readAdapterBindings(), {
            allowedPlatforms: adapterPlatforms,
            isSessionActive: isAdapterSessionActive,
        })
    }

    return {
        loadAdapterConfig,
        saveAdapterConfig,
        migrateAdapterCredentials,
        getAdapterConfigReadError: () => adapterConfigReadError,
        readAdapterBindings,
        writeAdapterBindings,
        listAdapterBindings: listBindings,
        readAdapterBinding,
        clearAdapterBindings,
        clearAdapterBindingsForSessions,
        isAdapterSessionActive,
        adapterOwnsSession,
        adapterOwnsFocusedSession,
        adapterOwnsProject,
    }
}
