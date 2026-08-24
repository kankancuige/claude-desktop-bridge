function json(res, status, body) {
    res.writeHead(status, {'Content-Type': 'application/json'})
    res.end(JSON.stringify(body))
}

function limit(value, fallback = 100) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.trunc(parsed))) : fallback
}

const SENSITIVE_KEY = /(password|passwd|token|secret|api[-_]?key|authorization|credential|prompt|request[-_]?text|file[-_]?path|workspace[-_]?path|absolute[-_]?path|working[-_]?directory|work[-_]?dir|cwd|(^|[-_])(path|file|directory)$)/i

function publicValue(value, depth = 0) {
    if (value == null || depth > 4) return null
    if (typeof value === 'string') return value.slice(0, 4000)
    if (typeof value === 'number' || typeof value === 'boolean') return value
    if (Array.isArray(value)) return value.slice(0, 100).map(item => publicValue(item, depth + 1))
    if (typeof value !== 'object') return null
    return Object.fromEntries(Object.entries(value).slice(0, 100).filter(([key]) => !SENSITIVE_KEY.test(key)).map(([key, item]) => [key, publicValue(item, depth + 1)]))
}

function publicTask(task) {
    if (!task || typeof task !== 'object') return null
    const allowed = ['taskId', 'taskKey', 'title', 'summary', 'goal', 'requestText', 'source', 'projectKey', 'sessionId', 'sdkSessionId', 'historySessionId', 'turnId', 'status', 'phase', 'createdAt', 'updatedAt', 'completedAt', 'execution', 'context']
    if ((!task.execution && task.state?.execution) || (!task.context && task.state?.context)) task = {...task, execution: task.execution || task.state.execution, context: task.context || task.state.context}
    const result = Object.fromEntries(allowed.filter(key => Object.prototype.hasOwnProperty.call(task, key)).map(key => [key, publicValue(task[key])] ))
    if (task.state && typeof task.state === 'object') result.state = publicValue(task.state)
    return result
}

function publicEvent(event) {
    if (!event || typeof event !== 'object') return null
    const result = {}
    for (const key of ['taskId', 'taskKey', 'projectKey', 'revision', 'eventType', 'createdAt']) {
        if (Object.prototype.hasOwnProperty.call(event, key)) result[key] = publicValue(event[key])
    }
    const payload = event.payload && typeof event.payload === 'object' ? event.payload : null
    if (payload) {
        const safePayload = {}
        for (const key of ['summary', 'reason', 'outcome', 'status', 'phase', 'source', 'turnId', 'sessionId', 'sequence', 'revision']) {
            if (Object.prototype.hasOwnProperty.call(payload, key)) safePayload[key] = publicValue(payload[key])
        }
        if (Object.keys(safePayload).length) result.payload = safePayload
    }
    return result
}

function publicReport(report) {
    if (!report || typeof report !== 'object') return null
    const allowed = ['taskId', 'taskKey', 'projectKey', 'sessionId', 'title', 'summary', 'status', 'startedAt', 'completedAt', 'durationMs', 'plannedSteps', 'actualSteps', 'changedFiles', 'tests', 'verification', 'unresolvedRisks', 'deviations', 'regressions', 'pitfalls', 'skills']
    return Object.fromEntries(allowed.filter(key => Object.prototype.hasOwnProperty.call(report, key)).map(key => [key, publicValue(report[key])]))
}

/** Workbench 查询/健康路由。通过 callbacks 注入状态仓储，避免依赖组合根变量。 */
export function createWorkbenchRoutes({version, getStorageHealth, getState, getRepositories, getPitfallAdmin, getAiHealth, getDriftCandidates, resolveSessionLink: resolveLink, getSessionLinkResolver, decode = value => value} = {}) {
    return async function handleWorkbenchRoute({req, res, url, readBody} = {}) {
        const state = getState?.() || null
        const workbench = getRepositories?.()?.workbench || null
        const pitfall = getRepositories?.()?.pitfall || null
        if (req.method === 'GET' && url.pathname === '/api/health') {
            const healthy = !state?.degraded
            const storage = getStorageHealth ? await getStorageHealth() : {mode: 'not_configured', healthy: false, reason: 'postgres_storage_not_configured'}
            json(res, healthy ? 200 : 503, {ok: healthy, version, stateStoreMode: state?.mode || 'unavailable', stateStoreSchemaVersion: state?.schemaVersion || 0, stateStoreDegraded: Boolean(state?.degraded), stateStoreDegradedReason: state?.degradedReason || null, storage})
            return true
        }
        if (req.method === 'GET' && url.pathname === '/api/workbench/reports') {
            const projectKey = String(url.searchParams.get('projectKey') || '').trim()
            const reports = state?.available ? workbench?.listReports({projectKey: projectKey || null, limit: 200}) || [] : []
            const tasks = state?.available ? workbench?.listTasks?.({projectKey: projectKey || null, limit: 500}) || [] : []
            const taskById = new Map(tasks.flatMap(task => [[task.taskId, task], [task.taskKey, task]].filter(([key]) => key)))
            json(res, 200, {reports: reports.slice(0, 200).map(report => publicReport({...report, title: report.title || taskById.get(report.taskId)?.title, summary: report.summary || taskById.get(report.taskId)?.summary})).filter(Boolean)})
            return true
        }
        if (req.method === 'GET' && url.pathname === '/api/workbench/tasks') {
            const projectKey = String(url.searchParams.get('projectKey') || '').trim()
            const activeOnly = ['1', 'true', 'yes'].includes(String(url.searchParams.get('activeOnly') || '').toLowerCase())
            const tasks = state?.available ? workbench?.listTasks({projectKey: projectKey || null, activeOnly, limit: limit(url.searchParams.get('limit'))}) || [] : []
            json(res, 200, {tasks: tasks.slice(0, 500).map(publicTask).filter(Boolean), stateStoreDegraded: Boolean(state?.degraded)})
            return true
        }
        const taskEventsMatch = url.pathname.match(/^\/api\/workbench\/tasks\/([^/]+)\/events$/)
        if (req.method === 'GET' && taskEventsMatch) {
            const projectKey = String(url.searchParams.get('projectKey') || '').trim()
            const taskId = decode(taskEventsMatch[1])
            if (!state?.available || !projectKey || !workbench?.listTaskEvents) { json(res, state?.available ? 404 : 503, {error: state?.available ? 'task_events_unavailable' : 'postgres_storage_unavailable'}); return true }
            const events = workbench.listTaskEvents({projectKey, taskId, limit: limit(url.searchParams.get('limit')), before: url.searchParams.get('before'), after: url.searchParams.get('after'), eventType: url.searchParams.get('eventType') || null}) || []
            json(res, 200, {events: Array.isArray(events) ? events.slice(0, 500).map(publicEvent).filter(Boolean) : []})
            return true
        }
        const sessionLinkMatch = url.pathname.match(/^\/api\/workbench\/tasks\/([^/]+)\/session-link$/)
        if (req.method === 'GET' && sessionLinkMatch) {
            const projectKey = String(url.searchParams.get('projectKey') || '').trim()
            const taskId = decode(sessionLinkMatch[1])
            const task = state?.available ? workbench?.getTask({projectKey, taskId}) : null
            if (!task) { json(res, state?.available ? 404 : 503, {error: state?.available ? 'task_not_found' : 'postgres_storage_unavailable'}); return true }
            const resolver = getSessionLinkResolver?.() || resolveLink
            const sessionLink = typeof resolver === 'function' ? resolver({task, projectKey}) : null
            json(res, sessionLink?.available ? 200 : 404, sessionLink || {projectKey, available: false, reason: 'session_link_unavailable'})
            return true
        }
        const detailMatch = url.pathname.match(/^\/api\/workbench\/tasks\/([^/]+)$/)
        if (req.method === 'GET' && detailMatch) {
            const projectKey = String(url.searchParams.get('projectKey') || '').trim()
            const taskId = decode(detailMatch[1])
            const detail = state?.available ? workbench?.getTaskDetail?.({projectKey, taskId}) : null
            if (!detail) { json(res, state?.available ? 404 : 503, {error: state?.available ? 'task_not_found' : 'postgres_storage_unavailable'}); return true }
            const resolver = getSessionLinkResolver?.() || resolveLink
            const sessionLink = typeof resolver === 'function' ? resolver({task: detail.task, projectKey}) : null
            const questions = (Array.isArray(detail.questions) ? detail.questions : []).slice(0, 200).map(question => {
                const questionTask = {...detail.task, taskId: question.taskId || detail.task.taskId, taskKey: question.taskId || detail.task.taskKey, sessionId: question.sessionId || detail.task.sessionId, sdkSessionId: question.sdkSessionId || detail.task.sdkSessionId, historySessionId: question.historySessionId || detail.task.historySessionId, turnId: question.turnId || detail.task.turnId}
                const questionLink = typeof resolver === 'function' ? resolver({task: questionTask, projectKey}) : null
                return {...question, sessionLink: questionLink}
            })
            json(res, 200, {task: publicTask(detail.task), events: Array.isArray(detail.events) ? detail.events.slice(0, 500).map(publicEvent).filter(Boolean) : [], questions, agents: publicValue(detail.agents || {}), workflows: publicValue(detail.workflows || {}), verification: publicValue(detail.verification || null), report: publicValue(detail.report || null), sessionLink: publicValue(sessionLink)})
            return true
        }
        if (req.method === 'GET' && url.pathname === '/api/workbench/projects') {
            json(res, 200, {projects: state?.available ? workbench?.listProjectKeys() || [] : [], stateStoreDegraded: Boolean(state?.degraded)})
            return true
        }
        const reportMatch = url.pathname.match(/^\/api\/workbench\/reports\/([^/]+)$/)
        if (req.method === 'GET' && reportMatch) {
            const report = state?.available ? workbench?.getReport(decode(reportMatch[1])) : null
            json(res, report ? 200 : 404, report ? {report: publicReport(report)} : {error: 'execution_report_not_found'})
            return true
        }
        if (req.method === 'GET' && url.pathname === '/api/workbench/pitfalls') {
            const projectKey = String(url.searchParams.get('projectKey') || '').trim()
            const admin = getPitfallAdmin?.()
            const pitfalls = !state?.available ? [] : projectKey ? pitfall?.findRelevant({projectKey, limit: 200}) || [] : pitfall?.listRecent({limit: 200}) || []
            json(res, 200, {pitfalls})
            return true
        }
        const pitfallMatch = url.pathname.match(/^\/api\/workbench\/pitfalls\/([^/]+)$/)
        if (req.method === 'PUT' && pitfallMatch) {
            const admin = getPitfallAdmin?.()
            if (!admin) { json(res, 503, {error: 'pitfall_store_unavailable'}); return true }
            try {
                const body = await readBody(req)
                const action = String(body.action || '')
                const id = decode(pitfallMatch[1])
                const changed = action === 'confirm' ? admin.confirm(id, {rootCause: body.rootCause, prevention: body.prevention}) : action === 'ignore' ? admin.ignore(id) : action === 'archive' ? admin.archive(id) : action === 'verify' ? admin.verify(id, body.evidence) : false
                if (!['confirm', 'ignore', 'archive', 'verify'].includes(action)) { json(res, 400, {error: 'invalid_pitfall_action'}); return true }
                json(res, changed ? 200 : 404, changed ? {ok: true} : {error: 'pitfall_not_found'})
            } catch (error) { json(res, 400, {error: String(error?.message || error)}) }
            return true
        }
        if (req.method === 'GET' && url.pathname === '/api/workbench/ai-health') {
            const projectKey = String(url.searchParams.get('projectKey') || '').trim()
            const reports = state?.available ? workbench?.listReports({projectKey: projectKey || null, limit: 200}) || [] : []
            const pitfalls = !state?.available ? [] : projectKey ? pitfall?.findRelevant({projectKey, limit: 200}) || [] : pitfall?.listRecent({limit: 200}) || []
            const health = getAiHealth?.() || {healthy: false, reason: 'ai_health_unavailable'}
            json(res, health.healthy ? 200 : 503, {health, driftCandidates: getDriftCandidates?.({executionReports: reports, pitfalls}) || []})
            return true
        }
        return false
    }
}
