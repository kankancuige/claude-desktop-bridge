import {join, basename, dirname} from 'node:path'
import {existsSync, renameSync, rmSync} from 'node:fs'

/** 项目与 Session 目录运行时。transcript 仍是文件所有权，PostgreSQL 只保存派生目录索引。 */
export function createProjectSessionRuntime({
    bridgeHome,
    projectsCacheTtl = 15_000,
    getScheduledTasks = () => ({}),
    deletedSessionsFile,
    readJSON,
    writeJSON,
    readdirSync,
    statSync,
    existsSync,
    readFileHeadLines,
    readHeadLines = readFileHeadLines,
    classifyTranscriptFile,
    decodeProjectName,
    encodeProjectName,
    normalizeWorkDir,
    reconcileSessionCatalog,
    loadSessionVisibility,
    markSessionVisible,
    migrateLegacySessionVisibility,
    removeSessionVisibility,
    sessionVisibilitySource,
    shouldShowSession,
    loadTaskState = () => null,
    getPersistedMirrors = () => null,
    sessionMirrorStorePath = workDir => join(bridgeHome, 'projects', encodeProjectName(workDir), 'bridge-session-mirrors.json'),
    sessionVisibilityStorePath = workDir => join(bridgeHome, 'projects', encodeProjectName(workDir), 'bridge-session-visibility.json'),
    getSessionRepository = () => null,
    saveSessionVisibility,
    loadSessionMap,
    saveSessionMap,
    getProjectVisibility,
    removePersistedSessionMirrors = () => true,
    deleteSession = async () => {},
    removeSessionMapEntry = (map, gatewaySessionId, sdkSessionId) => {
        const next = {...map}
        for (const [key, value] of Object.entries(next)) {
            const mappedSdkId = key.startsWith('@rev:') ? key.slice(5) : value
            if (key === gatewaySessionId || value === sdkSessionId || mappedSdkId === sdkSessionId) delete next[key]
        }
        return next
    },
    logger = {warn() {}, debug() {}},
} = {}) {
    if (!bridgeHome || typeof bridgeHome !== 'string') throw new TypeError('bridgeHome is required')
    if (typeof reconcileSessionCatalog !== 'function') throw new TypeError('reconcileSessionCatalog is required')
    if (typeof loadSessionVisibility !== 'function' || typeof shouldShowSession !== 'function') throw new TypeError('session visibility dependencies are required')
    const deletedSessions = new Map()
    try {
        const saved = readJSON(deletedSessionsFile)
        if (Array.isArray(saved)) {
            const now = Date.now()
            for (const [sessionId, expiresAt] of saved) if (expiresAt > now) deletedSessions.set(sessionId, expiresAt)
        }
    } catch (error) {
        logger.warn({err: error, path: deletedSessionsFile}, '恢复已删除 Session 标记失败')
    }
    let deletedDirty = false
    let deletedPersistScheduled = false
    let deletedPersistRetryCount = 0
    let projectsCache = null
    let projectsCacheTs = 0
    let scanningProjects = null

    async function removeSessionArtifact(path, {recursive = false} = {}) {
        const retryDelays = [0, 100, 300, 1000, 3000]
        let lastError = null
        for (const delayMs of retryDelays) {
            if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
            try {
                rmSync(path, {recursive, force: true})
                return
            } catch (error) {
                if (error?.code === 'ENOENT') return
                lastError = error
            }
        }
        if (!existsSync(path)) return
        const trashPath = join(dirname(path), `.trash-${Date.now()}-${basename(path)}`)
        try { renameSync(path, trashPath) } catch (error) { throw lastError || error }
    }

    function schedulePersistDeleted() {
        deletedDirty = true
        if (deletedPersistScheduled) return
        deletedPersistScheduled = true
        setImmediate(() => {
            deletedPersistScheduled = false
            if (!deletedDirty) return
            deletedDirty = false
            try {
                writeJSON(deletedSessionsFile, [...deletedSessions])
                deletedPersistRetryCount = 0
            } catch (error) {
                deletedDirty = true
                deletedPersistRetryCount++
                logger.warn({err: error, path: deletedSessionsFile}, '保存已删除 Session 标记失败')
                const timer = setTimeout(() => schedulePersistDeleted(), Math.min(30_000, 1000 * 2 ** Math.min(deletedPersistRetryCount - 1, 5)))
                timer.unref?.()
            }
        })
    }

    function markSessionDeleted(sessionId) {
        deletedSessions.set(sessionId, Date.now() + 1_800_000)
        if (deletedSessions.size > 500) {
            const now = Date.now()
            for (const [key, expiry] of deletedSessions) if (expiry < now) deletedSessions.delete(key)
        }
        schedulePersistDeleted()
    }

    function filterDeletedSessions(projects) {
        const now = Date.now()
        let dirty = false
        for (const [key, expiry] of deletedSessions) {
            if (expiry < now) { deletedSessions.delete(key); dirty = true }
        }
        if (dirty) schedulePersistDeleted()
        if (!deletedSessions.size && !dirty) return projects
        for (const project of projects) {
            project.sessions = project.sessions.filter(session => !deletedSessions.has(session.id))
            project.sessionCount = project.sessions.length
        }
        return projects.filter(project => project.sessionCount > 0)
    }

    function resolveTranscriptProjectWorkDir(projectDir, encodedDir) {
        try {
            const files = readdirSync(projectDir).filter(name => name.endsWith('.jsonl') && !name.startsWith('.trash-'))
            for (const file of files) {
                for (const line of readFileHeadLines(join(projectDir, file), 4096)) {
                    try {
                        const record = JSON.parse(line)
                        if (typeof record?.cwd === 'string' && record.cwd.trim()) return normalizeWorkDir(record.cwd)
                    } catch (error) {
                        if (!(error instanceof SyntaxError)) throw error
                    }
                }
            }
        } catch (error) {
            logger.debug({err: error, projectDir}, '读取 transcript 项目目录失败')
        }
        return decodeProjectName(encodedDir) || encodedDir
    }

    function collectTranscriptProjectGroups(projectsRoot = join(bridgeHome, 'projects')) {
        const groups = new Map()
        try {
            for (const entry of readdirSync(projectsRoot, {withFileTypes: true})) {
                if (!entry.isDirectory()) continue
                const projectDir = join(projectsRoot, entry.name)
                let hasTranscript = false
                try { hasTranscript = readdirSync(projectDir).some(name => name.endsWith('.jsonl') && !name.startsWith('.trash-')) } catch { continue }
                if (!hasTranscript) continue
                const workDir = resolveTranscriptProjectWorkDir(projectDir, entry.name)
                const normalized = normalizeWorkDir(workDir)
                if (!normalized) continue
                const identity = normalized.toLowerCase()
                const group = groups.get(identity) || {workDir: normalized, projectKey: encodeProjectName(normalized), projectDirs: []}
                group.projectDirs.push(projectDir)
                groups.set(identity, group)
            }
            for (const group of groups.values()) {
                const canonicalDir = join(projectsRoot, group.projectKey)
                if (existsSync(canonicalDir) && !group.projectDirs.includes(canonicalDir)) group.projectDirs.unshift(canonicalDir)
            }
        } catch (error) {
            logger.debug({err: error, projectsRoot}, '扫描 transcript 项目分组失败')
        }
        return [...groups.values()]
    }

    function loadProjectVisibilityWithMigration(projectDirs, workDir) {
        const directories = [...new Set((Array.isArray(projectDirs) ? projectDirs : [projectDirs]).filter(Boolean))]
        const canonicalDir = dirname(sessionVisibilityStorePath(workDir))
        let state = loadSessionVisibility(canonicalDir)
        for (const projectDir of directories) {
            if (projectDir === canonicalDir) continue
            const legacy = loadSessionVisibility(projectDir)
            for (const [gatewaySessionId, entry] of Object.entries(legacy.sessions || {})) state = markSessionVisible(state, {gatewaySessionId, ...entry})
        }
        if (state.legacyMigrationVersion >= 2) return state
        const sessionMap = {}
        for (const projectDir of [...directories, canonicalDir]) Object.assign(sessionMap, readJSON(join(projectDir, 'bridge-session-map.json')) || {})
        const transcriptKinds = {}
        const taskStates = {}
        for (const [gatewaySessionId, sdkSessionId] of Object.entries(sessionMap)) {
            if (gatewaySessionId.startsWith('@rev:') || typeof sdkSessionId !== 'string') continue
            const transcriptPath = [...directories, canonicalDir].map(projectDir => join(projectDir, `${sdkSessionId}.jsonl`)).find(path => existsSync(path))
            if (transcriptPath) transcriptKinds[sdkSessionId] = classifyTranscriptFile(transcriptPath)
            taskStates[gatewaySessionId] = readJSON(join(canonicalDir, 'bridge-task-state', `${gatewaySessionId}.json`))
            taskStates[sdkSessionId] = readJSON(join(canonicalDir, 'bridge-task-state', `${sdkSessionId}.json`))
        }
        let migrated = migrateLegacySessionVisibility(state, {sessionMap, transcriptKinds, taskStates})
        const scheduledIds = new Set(Object.values(getScheduledTasks() || {}).map(task => String(task?.sessionId || '').trim()).filter(Boolean))
        const internalSdkIds = new Set(Object.entries(sessionMap)
            .filter(([gatewaySessionId]) => gatewaySessionId.startsWith('@rev:') || /^(?:agent-|wf-agent-)/.test(gatewaySessionId) || scheduledIds.has(gatewaySessionId))
            .map(([, sdkSessionId]) => sdkSessionId))
        for (const projectDir of directories) {
            let filenames = []
            try { filenames = readdirSync(projectDir).filter(name => name.endsWith('.jsonl') && !name.startsWith('.trash-')) } catch { continue }
            for (const filename of filenames) {
                const sdkSessionId = filename.slice(0, -'.jsonl'.length)
                if (shouldShowSession(migrated, sdkSessionId) || scheduledIds.has(sdkSessionId) || internalSdkIds.has(sdkSessionId)) continue
                if (classifyTranscriptFile(join(projectDir, filename)) !== 'main') continue
                migrated = markSessionVisible(migrated, {gatewaySessionId: sdkSessionId, sdkSessionId, source: 'desktop', firstInputAt: 0})
            }
        }
        migrated = {...migrated, legacyMigrationVersion: 2}
        saveSessionVisibility(workDir, migrated)
        return migrated
    }

    async function scanProjects() {
        const now = Date.now()
        if (projectsCache && now - projectsCacheTs < projectsCacheTtl) return filterDeletedSessions(projectsCache)
        if (scanningProjects) return scanningProjects.then(filterDeletedSessions)
        scanningProjects = (async () => {
            const results = []
            try {
                for (const group of collectTranscriptProjectGroups()) {
                    try {
                        const visibility = loadProjectVisibilityWithMigration(group.projectDirs, group.workDir)
                        const catalogRows = reconcileSessionCatalog({
                            projectKey: group.projectKey, projectDirs: group.projectDirs, workDir: group.workDir, visibility,
                            repository: getSessionRepository(), readHeadLines,
                            settingsForSession: sessionId => ({
                                permissionMode: loadTaskState(group.workDir, sessionId)?.permissionMode || null,
                                mirrors: getPersistedMirrors(readJSON(sessionMirrorStorePath(group.workDir)), [sessionId]),
                            }),
                        }).filter(row => !deletedSessions.has(row.id))
                        if (!catalogRows.length) continue
                        results.push({workDir: group.workDir, encodedDir: group.projectKey, sessionCount: catalogRows.length,
                            sessions: catalogRows.map(row => ({id: row.id, title: row.title, size: row.size, encodedDir: group.projectKey})),
                            lastActive: Math.max(...catalogRows.map(row => Number(row.mtime || 0)), 0)})
                    } catch (error) {
                        logger.warn({err: error, workDir: group.workDir, projectKey: group.projectKey}, '项目会话目录协调失败，已跳过当前项目')
                    }
                }
            } catch (error) { logger.debug({err: error}, '扫描项目失败') }
            results.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))
            projectsCache = filterDeletedSessions(results)
            projectsCacheTs = Date.now()
            return projectsCache
        })().finally(() => { scanningProjects = null })
        return scanningProjects
    }

    async function listProjectSessions(encodedDir) {
        const group = collectTranscriptProjectGroups().find(item => item.projectKey === encodedDir || item.projectDirs.some(path => basename(path) === encodedDir))
        if (!group) return []
        const visibility = loadProjectVisibilityWithMigration(group.projectDirs, group.workDir)
        return reconcileSessionCatalog({
            projectKey: group.projectKey, projectDirs: group.projectDirs, workDir: group.workDir, visibility,
            repository: getSessionRepository(), readHeadLines,
            settingsForSession: sessionId => ({
                permissionMode: loadTaskState(group.workDir, sessionId)?.permissionMode || null,
                mirrors: getPersistedMirrors(readJSON(sessionMirrorStorePath(group.workDir)), [sessionId]),
            }),
        }).filter(row => !deletedSessions.has(row.id)).map(row => ({id: row.id, title: row.title, size: row.size, mtime: row.mtime, encodedDir: group.projectKey}))
    }

    function invalidateProjectsCache() { projectsCache = null }
    async function deleteSessionFiles(sessionId, relatedSessionIds = []) {
        const projectsRoot = join(bridgeHome, 'projects')
        let entries
        try { entries = readdirSync(projectsRoot) } catch (error) {
            if (error?.code === 'ENOENT') return
            throw error
        }
        const targetIds = new Set([sessionId, ...relatedSessionIds].filter(Boolean))
        const projects = []
        for (const entry of entries) {
            const workDir = decodeProjectName(entry)
            if (!workDir) continue
            const sdkDir = join(projectsRoot, entry)
            const map = loadSessionMap(workDir)
            projects.push({workDir, sdkDir, map})
            let expanded = true
            while (expanded) {
                expanded = false
                for (const [key, value] of Object.entries(map)) {
                    const gatewayId = key.startsWith('@rev:') ? value : key
                    const sdkId = key.startsWith('@rev:') ? key.slice(5) : value
                    if (!targetIds.has(gatewayId) && !targetIds.has(sdkId)) continue
                    if (gatewayId && !targetIds.has(gatewayId)) { targetIds.add(gatewayId); expanded = true }
                    if (sdkId && !targetIds.has(sdkId)) { targetIds.add(sdkId); expanded = true }
                }
            }
        }
        const failures = []
        for (const {sdkDir} of projects) {
            for (const targetId of targetIds) {
                const transcriptPath = join(sdkDir, `${targetId}.jsonl`)
                const sessionDir = join(sdkDir, targetId)
                if (!existsSync(transcriptPath) && !existsSync(sessionDir)) continue
                try { await deleteSession(targetId, {dir: sdkDir}) } catch (error) { logger.debug({err: error, sessionId: targetId?.slice(0, 8)}, 'SDK 删除 Session 文件失败，执行本地兜底清理') }
                for (const [path, recursive] of [[transcriptPath, false], [sessionDir, true]]) {
                    if (!existsSync(path)) continue
                    try { await removeSessionArtifact(path, {recursive}) } catch (error) { failures.push(error); logger.warn({err: error, path}, '清理 Session 残留失败') }
                }
                getSessionRepository()?.removeByTranscriptPath?.(transcriptPath)
            }
        }
        for (const {workDir, sdkDir, map} of projects) {
            let nextMap = map
            for (const targetId of targetIds) nextMap = removeSessionMapEntry(nextMap, targetId, targetId)
            if (JSON.stringify(nextMap) !== JSON.stringify(map) && !saveSessionMap(workDir, nextMap)) failures.push(new Error(`保存清理后的 Session 映射失败: ${workDir}`))
            const visibility = getProjectVisibility(workDir)
            let nextVisibility = visibility
            for (const targetId of targetIds) nextVisibility = removeSessionVisibility(nextVisibility, {gatewaySessionId: targetId, sdkSessionId: targetId})
            if (JSON.stringify(nextVisibility) !== JSON.stringify(visibility) && !saveSessionVisibility(workDir, nextVisibility)) failures.push(new Error(`保存清理后的 Session 可见性失败: ${workDir}`))
            for (const targetId of targetIds) {
                for (const artifact of [
                    join(sdkDir, 'bridge-snapshot', `${targetId}.json`),
                    join(sdkDir, 'bridge-checkpoints', `${targetId}.json`),
                    join(sdkDir, 'bridge-task-state', `${targetId}.json`),
                    join(sdkDir, 'bridge-session-events', `${targetId}.jsonl`),
                ]) {
                    if (!existsSync(artifact)) continue
                    try { await removeSessionArtifact(artifact) } catch (error) { failures.push(error); logger.warn({err: error, path: artifact}, '清理 Session 元数据失败') }
                }
            }
            if (!removePersistedSessionMirrors(workDir, targetIds)) failures.push(new Error(`清理 Session 镜像状态失败: ${workDir}`))
        }
        invalidateProjectsCache()
        if (failures.length) throw new AggregateError(failures, `清理 Session 文件失败: ${failures.length} 项`)
    }

    return {scanProjects, listProjectSessions, deleteSessionFiles, markSessionDeleted, filterDeletedSessions, invalidateProjectsCache, deletedSessions, collectTranscriptProjectGroups, loadProjectVisibilityWithMigration}
}
