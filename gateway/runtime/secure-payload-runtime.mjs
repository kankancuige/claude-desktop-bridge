/** Electron 注入和环境变量提供的安全 Payload 主密钥初始化。 */
export function createSecurePayloadRuntime({
    configureSecurePayloadMasterKey,
    env = process.env,
    processLike = process,
    logger = {warn() {}, error() {}},
    timeoutMs = 5000,
} = {}) {
    if (typeof configureSecurePayloadMasterKey !== 'function') throw new TypeError('secure payload configurator is required')
    async function initializeSecurePayloadKey() {
        const environmentKey = env.BRIDGE_SECURE_PAYLOAD_KEY
        if (environmentKey) {
            try {
                configureSecurePayloadMasterKey(environmentKey)
                delete env.BRIDGE_SECURE_PAYLOAD_KEY
                return true
            } catch (error) {
                delete env.BRIDGE_SECURE_PAYLOAD_KEY
                logger.error({err: error}, '环境变量中的安全存储密钥无效')
                return false
            }
        }
        if (typeof processLike.send !== 'function') return false
        return new Promise(resolve => {
            let settled = false
            let timer
            const finish = configured => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                processLike.off?.('message', onMessage)
                resolve(configured)
            }
            const onMessage = message => {
                if (message?.type !== 'bridge:init') return
                try { configureSecurePayloadMasterKey(message.securePayloadKey); finish(true) }
                catch (error) { logger.error({err: error}, 'Electron 注入的安全存储密钥无效'); finish(false) }
            }
            timer = setTimeout(() => finish(false), timeoutMs)
            timer.unref?.()
            processLike.on?.('message', onMessage)
            processLike.send({type: 'bridge:init-request'})
        })
    }
    return {initializeSecurePayloadKey}
}
