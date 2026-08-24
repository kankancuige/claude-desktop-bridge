function json(res, status, body) {
    res.writeHead(status, {'Content-Type': 'application/json'})
    res.end(JSON.stringify(body))
}
export function createConfigRoutes({
    bridgeHome,
    version,
    readJSON,
    writeJSON,
    backupFile,
    loadBridgeProviderSettings,
    saveBridgeProviderSettings,
    overlayBridgeProviderSettings,
    extractBridgeProviderSettings,
    stripBridgeProviderSettings,
    redactSecretMap,
    restoreSecretMap,
    getClaudeExe,
    loadCliSettingsForUpdate,
    setClaudeExe,
    existsSync,
    readBody,
    log,
} = {}) {
    return async function handleConfigRoute({req, res, url} = {}) {
        if (url.pathname === '/api/config/settings') {
            const settingsPath = `${bridgeHome}/settings.json`
            if (req.method === 'GET') {
                const current = readJSON(settingsPath) || {}
                const effective = overlayBridgeProviderSettings(current, loadBridgeProviderSettings())
                json(res, 200, {...effective, env: redactSecretMap(effective.env)})
                return true
            }
            if (req.method === 'PUT') {
                try {
                    const body = await readBody(req)
                    if (body._parseError || body._bodyTooLarge) {
                        json(res, body._bodyTooLarge ? 413 : 400, {error: body._bodyTooLarge ? 'payload too large' : 'invalid JSON'})
                        return true
                    }
                    const current = readJSON(settingsPath) || {}
                    const currentProvider = loadBridgeProviderSettings()
                    const currentEffective = overlayBridgeProviderSettings(current, currentProvider)
                    if (body.env) {
                        body.env = restoreSecretMap(body.env, currentEffective.env || {})
                        body.env.ANTHROPIC_MODEL = body.model || ''
                        saveBridgeProviderSettings(extractBridgeProviderSettings(body, currentProvider))
                        for (const key of ['ANTHROPIC_DEFAULT_OPUS_MODEL_NAME', 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL']) delete body.env[key]
                    }
                    backupFile(settingsPath)
                    writeJSON(settingsPath, stripBridgeProviderSettings(body))
                    json(res, 200, {ok: true})
                } catch (error) {
                    json(res, 500, {error: error.message})
                }
                return true
            }
        }
        if (req.method === 'GET' && url.pathname === '/api/version') {
            json(res, 200, {version})
            return true
        }
        if (req.method === 'GET' && url.pathname === '/api/config/claude-status') {
            const configured = url.searchParams.get('path')
            const path = configured ? (existsSync(configured) ? configured : null) : getClaudeExe()
            json(res, 200, {found: Boolean(path), path})
            return true
        }
        if (req.method === 'POST' && url.pathname === '/api/config/claude-path') {
            try {
                const body = await readBody(req)
                const path = String(body.path || '').trim()
                if (!path) { json(res, 400, {ok: false, error: 'path required'}); return true }
                if (!existsSync(path)) { json(res, 200, {ok: false, found: false, path, error: '文件不存在'}); return true }
                const settings = loadCliSettingsForUpdate()
                settings.claudeExe = path
                const settingsPath = `${bridgeHome}/settings.json`
                backupFile(settingsPath)
                writeJSON(settingsPath, settings)
                setClaudeExe(path)
                log?.info?.({path}, '用户手动设置 claudeExe')
                json(res, 200, {ok: true, found: true, path})
            } catch (error) {
                json(res, 500, {ok: false, error: error.message})
            }
            return true
        }
        return false
    }
}
