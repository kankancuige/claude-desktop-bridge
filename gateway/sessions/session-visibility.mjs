import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'

const FILE_NAME = 'bridge-session-visibility.json'
const SOURCES = new Set(['desktop', 'wechat', 'feishu', 'dingtalk'])

function normalizeId(value) {
    const text = String(value || '').trim()
    return text.length > 0 && text.length <= 200 ? text : null
}

export function sessionVisibilityPath(projectDir) {
    return join(projectDir, FILE_NAME)
}

export function loadSessionVisibility(projectDir) {
    try {
        const value = JSON.parse(readFileSync(sessionVisibilityPath(projectDir), 'utf8'))
        if (!value || typeof value !== 'object') return {sessions: {}}
        const sessions = {}
        for (const [gatewayId, entry] of Object.entries(value.sessions || {})) {
            const gatewaySessionId = normalizeId(gatewayId)
            if (!gatewaySessionId || !entry || typeof entry !== 'object') continue
            const sdkSessionId = normalizeId(entry.sdkSessionId)
            const source = SOURCES.has(entry.source) ? entry.source : null
            if (!source) continue
            sessions[gatewaySessionId] = {
                sdkSessionId,
                source,
                firstInputAt: Number.isFinite(entry.firstInputAt) ? entry.firstInputAt : 0,
            }
        }
        return {
            version: 1,
            legacyMigrationVersion: Number.isInteger(value.legacyMigrationVersion) ? value.legacyMigrationVersion : 0,
            sessions,
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') return {version: 1, sessions: {}}
        return {version: 1, sessions: {}}
    }
}

export function visibleSessionIds(state) {
    const gatewayIds = new Set()
    const sdkIds = new Set()
    for (const [gatewayId, entry] of Object.entries(state?.sessions || {})) {
        gatewayIds.add(gatewayId)
        if (entry?.sdkSessionId) sdkIds.add(entry.sdkSessionId)
    }
    return {gatewayIds, sdkIds}
}

export function markSessionVisible(state, {gatewaySessionId, sdkSessionId = null, source, firstInputAt = Date.now()}) {
    const gatewayId = normalizeId(gatewaySessionId)
    if (!gatewayId || !SOURCES.has(source)) return state || {version: 1, sessions: {}}
    const sessions = {...(state?.sessions || {})}
    const previous = sessions[gatewayId] || {}
    sessions[gatewayId] = {
        sdkSessionId: normalizeId(sdkSessionId) || previous.sdkSessionId || null,
        source: previous.source || source,
        firstInputAt: previous.firstInputAt || firstInputAt,
    }
    return {version: 1, legacyMigrationVersion: state?.legacyMigrationVersion || 0, sessions}
}

export function removeSessionVisibility(state, {gatewaySessionId, sdkSessionId = null}) {
    const sessions = {...(state?.sessions || {})}
    const gatewayId = normalizeId(gatewaySessionId)
    const sdkId = normalizeId(sdkSessionId)
    if (gatewayId && sessions[gatewayId]) delete sessions[gatewayId]
    if (sdkId) {
        for (const [id, entry] of Object.entries(sessions)) {
            if (entry?.sdkSessionId === sdkId) delete sessions[id]
        }
    }
    return {version: 1, legacyMigrationVersion: state?.legacyMigrationVersion || 0, sessions}
}

export function shouldShowSession(state, sessionId) {
    const id = normalizeId(sessionId)
    if (!id) return false
    const {gatewayIds, sdkIds} = visibleSessionIds(state)
    return gatewayIds.has(id) || sdkIds.has(id)
}

export function filterVisibleSessionIds(state, sessionIds) {
    return (Array.isArray(sessionIds) ? sessionIds : []).filter(sessionId => shouldShowSession(state, sessionId))
}

export function isUserSessionSource(source) {
    return SOURCES.has(source)
}

export function sessionVisibilitySource(state, gatewaySessionId, sdkSessionId = null) {
    const gatewayId = normalizeId(gatewaySessionId)
    const sdkId = normalizeId(sdkSessionId)
    if (gatewayId && state?.sessions?.[gatewayId]?.source) return state.sessions[gatewayId].source
    if (sdkId) {
        for (const entry of Object.values(state?.sessions || {})) {
            if (entry?.sdkSessionId === sdkId) return entry.source || null
        }
    }
    return null
}

export function migrateLegacySessionVisibility(state, {sessionMap = {}, transcriptKinds = {}, taskStates = {}} = {}) {
    let next = state || {version: 1, sessions: {}}
    for (const [gatewaySessionId, sdkSessionId] of Object.entries(sessionMap)) {
        if (gatewaySessionId.startsWith('@rev:') || /^(?:agent-|wf-agent-)/.test(gatewaySessionId)) continue
        if (transcriptKinds[sdkSessionId] !== 'main') continue
        const taskState = taskStates[gatewaySessionId] || taskStates[sdkSessionId]
        const hasTurnEvidence = Boolean(taskState?.taskId || taskState?.turnId)
        const hasPersistedSessionIdentity = taskState && (
            taskState.sdkSessionId === sdkSessionId || taskState.historySessionId === sdkSessionId
        )
        if (!hasTurnEvidence && !hasPersistedSessionIdentity) continue
        next = markSessionVisible(next, {
            gatewaySessionId,
            sdkSessionId,
            source: 'desktop',
            firstInputAt: Number(taskState.updatedAt) || 0,
        })
    }
    return {...next, legacyMigrationVersion: 1}
}

export {SOURCES as SESSION_VISIBILITY_SOURCES}
