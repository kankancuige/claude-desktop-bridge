/** 启动时只读审计 Hook 脚本，不在未确认时改写用户配置。 */
export function createHookValidationRuntime({bridgeHome, joinPath, basename, readJSON, safeBasename, exists, logger = {warn() {}}} = {}) {
    if (!bridgeHome || typeof joinPath !== 'function' || typeof basename !== 'function'
        || typeof readJSON !== 'function' || typeof safeBasename !== 'function' || typeof exists !== 'function') {
        throw new TypeError('hook validation dependencies are required')
    }

    function validateHooks() {
        const settings = readJSON(joinPath(bridgeHome, 'settings.json'))
        if (!settings?.hooks || typeof settings.hooks !== 'object') return
        const hooksDir = joinPath(bridgeHome, 'hooks')
        for (const [eventType, entries] of Object.entries(settings.hooks)) {
            if (!Array.isArray(entries)) continue
            for (const entry of entries) {
                for (const hook of entry?.hooks || []) {
                    if (hook?.type !== 'command') continue
                    const rawLastArg = String(hook.command || '').match(/(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/)
                    const scriptFile = basename(rawLastArg?.[1] || rawLastArg?.[2] || rawLastArg?.[3] || '')
                    if (!scriptFile || !/\.(sh|js|mjs|cjs|ps1)$/i.test(scriptFile)) continue
                    const scriptPath = safeBasename(hooksDir, scriptFile, {extensions: ['.sh', '.js', '.mjs', '.cjs', '.ps1']})
                    if (scriptPath && !exists(scriptPath)) logger.warn({eventType, script: scriptFile}, 'Hook 脚本缺失，请在设置页确认或修复')
                }
            }
        }
    }

    return {validateHooks}
}
