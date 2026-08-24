import {readdirSync, statSync} from 'node:fs'
import {join} from 'node:path'
import {classifyTranscriptFile} from '../projects/transcript-classifier.mjs'
import {sessionVisibilitySource, shouldShowSession} from './session-visibility.mjs'

function sessionIdFromFile(name) {
    return name.endsWith('.jsonl') ? name.slice(0, -'.jsonl'.length) : null
}

function titleFromLines(lines, fallback) {
    for (const line of Array.isArray(lines) ? lines : []) {
        if (!line?.trim()) continue
        try {
            const record = JSON.parse(line)
            let text = record?.content || ''
            if (!text && record?.message?.content) {
                text = typeof record.message.content === 'string'
                    ? record.message.content
                    : Array.isArray(record.message.content)
                        ? record.message.content.find(item => typeof item?.text === 'string')?.text || ''
                        : ''
            }
            if (text && !String(text).startsWith('<task-notification')) return String(text).slice(0, 50)
        } catch {
            // 正在写入的半行不影响其余完整记录。
        }
    }
    return fallback
}

/**
 * 增量协调一个项目的 transcript 元数据到 PostgreSQL 派生目录。
 * transcript 始终保留在文件系统；mtime/size 未变化时不重新读取标题和分类。
 */
export function reconcileSessionCatalog({
    projectKey,
    projectDir,
    projectDirs = null,
    workDir,
    visibility,
    repository = null,
    readHeadLines = () => [],
    settingsForSession = () => null,
    maxSessions = 500,
    repairLegacyMainTranscripts = false,
} = {}) {
    const rows = []
    const seenPaths = new Set()
    let candidates = []
    const directories = [...new Set((Array.isArray(projectDirs) ? projectDirs : [projectDir]).filter(Boolean))]
    for (const directory of directories) {
        try {
            candidates.push(...readdirSync(directory)
                .filter(name => name.endsWith('.jsonl') && !name.startsWith('.trash-'))
                .map(filename => {
                    const transcriptPath = join(directory, filename)
                    try {
                        const stat = statSync(transcriptPath)
                        return stat.isFile() ? {filename, transcriptPath, stat} : null
                    } catch {
                        return null
                    }
                })
                .filter(Boolean))
        } catch {
            // 单个旧目录损坏或刚被移除时，继续协调同 cwd 的其他目录。
        }
    }
    candidates = [...candidates
        .sort((a, b) => Number(b.stat.mtimeMs || 0) - Number(a.stat.mtimeMs || 0))
        .reduce((bySessionId, candidate) => {
            const sessionId = sessionIdFromFile(candidate.filename)
            if (sessionId && !bySessionId.has(sessionId)) bySessionId.set(sessionId, candidate)
            return bySessionId
        }, new Map())
        .values()]
    const limitedCandidates = candidates.slice(0, Math.max(1, Math.min(5000, Number(maxSessions) || 500)))
    const sessionRepository = repository
    const previousById = sessionRepository
        ? sessionRepository.getMany({projectKey, sessionIds: limitedCandidates.map(item => sessionIdFromFile(item.filename))})
        : new Map()
    for (const {filename, transcriptPath, stat} of limitedCandidates) {
        const sessionId = sessionIdFromFile(filename)
        const previous = previousById.get(sessionId) || null
        const visibleFromIndex = previous?.visibility === 'visible'
        const unchanged = previous
            && previous.transcriptPath === transcriptPath
            && Number(previous.mtime) === Number(stat.mtimeMs)
            && Number(previous.size) === Number(stat.size)
        const kind = unchanged ? previous?.kind || null : classifyTranscriptFile(transcriptPath)
        const repairedLegacyMain = repairLegacyMainTranscripts && kind === 'main' && previous?.visibility !== 'hidden'
        if (!sessionId || (!shouldShowSession(visibility, sessionId) && !visibleFromIndex && !repairedLegacyMain)) continue
        seenPaths.add(transcriptPath)
        const title = unchanged ? (previous.title || sessionId.slice(0, 8)) : titleFromLines(readHeadLines(transcriptPath, 4096), sessionId.slice(0, 8))
        const source = sessionVisibilitySource(visibility, null, sessionId) || previous?.source || 'desktop'
        const importedSettings = !previous || previous.permissionMode == null || previous.mirrors == null
            ? settingsForSession(sessionId) || {}
            : {}
        const row = {
            id: sessionId,
            projectKey,
            sessionId,
            sdkSessionId: sessionId,
            workDir,
            source,
            visibility: 'visible',
            transcriptPath,
            title,
            size: stat.size,
            mtime: stat.mtimeMs,
            kind,
            encodedDir: projectKey,
            permissionMode: previous?.permissionMode ?? importedSettings.permissionMode ?? null,
            mirrors: previous?.mirrors ?? importedSettings.mirrors ?? null,
            lastOpenedAt: previous?.lastOpenedAt ?? importedSettings.lastOpenedAt ?? null,
            runtimeRevision: previous?.runtimeRevision ?? importedSettings.runtimeRevision ?? null,
        }
        rows.push(row)
    }
    if (sessionRepository) {
        sessionRepository.upsertBatch(rows)
        for (const indexed of sessionRepository.list({projectKey, limit: 500})) {
            if (!seenPaths.has(indexed.transcriptPath)) sessionRepository.removeByTranscriptPath(indexed.transcriptPath)
        }
    }
    return rows.sort((a, b) => Number(b.mtime || 0) - Number(a.mtime || 0))
}
