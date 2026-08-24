function json(res, status, body) {
    res.writeHead(status, {'Content-Type': 'application/json'})
    res.end(JSON.stringify(body))
}
export function createPreferencesRoutes({getService, decode = value => value, basename = value => value, isDirectoryPath, readBody} = {}) {
    return async function handlePreferencesRoute({req, res, url} = {}) {
        const service = getService?.()
        if (!service) return false
        if (req.method === 'GET' && url.pathname === '/api/preferences') {
            json(res, 200, service.listAll())
            return true
        }
        const suggestionMatch = url.pathname.match(/^\/api\/preferences\/suggestions\/([^/]+)\/respond$/)
        if (req.method === 'POST' && suggestionMatch) {
            const body = await readBody(req)
            if (body._bodyTooLarge || body._bodyError || body._parseError || !isDirectoryPath?.(body.projectDir)) {
                json(res, 400, {error: 'invalid preference request'})
                return true
            }
            try {
                json(res, 200, service.respond({
                    projectDir: body.projectDir,
                    suggestionId: decode(suggestionMatch[1]),
                    action: body.action,
                }))
            } catch (error) {
                json(res, error.code === 'PREFERENCE_SUGGESTION_NOT_FOUND' ? 404 : 400, {
                    error: error.message,
                    code: error.code || 'PREFERENCE_RESPONSE_FAILED',
                })
            }
            return true
        }
        const preferenceMatch = url.pathname.match(/^\/api\/preferences\/(global|project)\/([^/]+)$/)
        if ((req.method === 'PUT' || req.method === 'DELETE') && preferenceMatch) {
            const scope = preferenceMatch[1]
            const id = decode(preferenceMatch[2])
            const body = await readBody(req)
            const encodedDir = scope === 'project'
                ? decode(body.encodedDir || url.searchParams.get('encodedDir') || '')
                : ''
            if (scope === 'project' && (!encodedDir || basename(encodedDir) !== encodedDir)) {
                json(res, 400, {error: 'project preference requires encodedDir'})
                return true
            }
            try {
                const preference = req.method === 'PUT'
                    ? service.update({scope, id, enabled: body.enabled !== false, encodedDir})
                    : service.remove({scope, id, encodedDir})
                json(res, 200, {ok: true, preference})
            } catch (error) {
                json(res, error.code === 'PREFERENCE_NOT_FOUND' ? 404 : 400, {
                    error: error.message,
                    code: error.code || 'PREFERENCE_MUTATION_FAILED',
                })
            }
            return true
        }
        return false
    }
}
