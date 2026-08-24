function json(res, status, body) {
    res.writeHead(status, {'Content-Type': 'application/json'})
    res.end(JSON.stringify(body))
}

export function createSessionProjectRoutes({
    getSessions,
    getFocusedSessionId,
    setFocusedSessionId,
    getAdapterIdentity,
    adapterOwnsFocusedSession,
    adapterOwnsProject,
    readAdapterBinding,
    scanProjects,
    listProjectSessions,
    decodeProject,
    isSafeProject,
    findTranscript,
    parseHistory,
    readFile,
    log,
} = {}) {
    return async function handleSessionProjectRoute({req, res, url} = {}) {
        const sessions = getSessions?.() || new Map()
        if (req.method === 'GET' && url.pathname === '/api/sessions') {
            const list = [...sessions.entries()].map(([id, session]) => ({
                id,
                workDir: session.workDir,
                createdAt: session.createdAt,
                clientCount: session.clients?.size || 0,
            }))
            json(res, 200, {sessions: list, total: list.length})
            return true
        }
        if (req.method === 'GET' && url.pathname === '/api/sessions/focused') {
            const identity = getAdapterIdentity?.(req)
            if (identity && !adapterOwnsFocusedSession?.(identity)) {
                json(res, 403, {error: 'session ownership mismatch'})
                return true
            }
            const focusedSessionId = getFocusedSessionId?.()
            const session = focusedSessionId ? sessions.get(focusedSessionId) : null
            if (!session) {
                json(res, 404, {error: 'no focused session'})
                return true
            }
            json(res, 200, {sessionId: focusedSessionId, workDir: session.workDir})
            return true
        }
        if (req.method === 'POST' && url.pathname.startsWith('/api/sessions/') && url.pathname.endsWith('/focus')) {
            const sessionId = url.pathname.split('/')[3]
            if (!sessions.has(sessionId)) {
                json(res, 404, {error: 'session not found'})
                return true
            }
            setFocusedSessionId?.(sessionId)
            json(res, 200, {ok: true, focused: sessionId.slice(0, 8)})
            return true
        }
        if (req.method === 'GET' && url.pathname === '/api/projects') {
            const identity = getAdapterIdentity?.(req)
            const allProjects = await scanProjects?.() || []
            let projects = allProjects
            if (identity) {
                if (!readAdapterBinding?.(identity)) {
                    json(res, 403, {error: 'session ownership mismatch'})
                    return true
                }
                projects = allProjects.filter(project => adapterOwnsProject?.(identity, project.encodedDir))
            }
            json(res, 200, {projects})
            return true
        }
        const projectSessionsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/sessions$/)
        if (req.method === 'GET' && projectSessionsMatch) {
            const encodedDir = decodeProject?.(projectSessionsMatch[1]) || ''
            if (!encodedDir || !isSafeProject?.(encodedDir)) {
                json(res, 400, {error: 'invalid project'})
                return true
            }
            const identity = getAdapterIdentity?.(req)
            if (identity && !adapterOwnsProject?.(identity, encodedDir)) {
                json(res, 403, {error: 'project ownership mismatch'})
                return true
            }
            json(res, 200, {sessions: await listProjectSessions?.(encodedDir) || []})
            return true
        }
        const historyMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/messages$/)
        if (req.method === 'GET' && historyMatch) {
            const encodedDir = decodeProject?.(historyMatch[1]) || ''
            const sessionId = historyMatch[2]
            const identity = getAdapterIdentity?.(req)
            if (identity && !adapterOwnsProject?.(identity, encodedDir)) {
                json(res, 403, {error: 'project ownership mismatch'})
                return true
            }
            const location = findTranscript?.({encodedDir, sessionId})
            if (location?.status === 'invalid') {
                json(res, 400, {error: 'invalid project or session'})
                return true
            }
            if (location?.status === 'ambiguous') {
                log?.error?.({sessionId: sessionId.slice(0, 8), matches: location.matches}, '会话 transcript 目录存在歧义')
                json(res, 409, {error: '会话 transcript 目录存在歧义', code: 'HISTORY_LOCATION_AMBIGUOUS'})
                return true
            }
            if (location?.status !== 'found') {
                json(res, 404, {error: '历史会话不存在', code: 'HISTORY_NOT_FOUND'})
                return true
            }
            if (identity && !adapterOwnsProject?.(identity, location.encodedDir)) {
                json(res, 403, {error: 'project ownership mismatch'})
                return true
            }
            try {
                const messages = parseHistory(readFile(location.filePath, 'utf8'))
                json(res, 200, {messages, encodedDir: location.encodedDir})
            } catch (error) {
                log?.warn?.({err: error, sessionId: sessionId.slice(0, 8), encodedDir: location.encodedDir}, '读取会话历史失败')
                json(res, 500, {error: '历史会话读取失败', code: 'HISTORY_READ_FAILED'})
            }
            return true
        }
        return false
    }
}
