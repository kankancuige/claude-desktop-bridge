import {closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync} from 'node:fs'
import {join} from 'node:path'

const SESSION_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/** 将 URL 路径段安全还原为 Bridge 私有 projects 下的单个目录名。 */
export function decodeProjectDirectorySegment(value) {
    let decoded
    try {
        decoded = decodeURIComponent(String(value || ''))
    } catch {
        return null
    }
    if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) return null
    return decoded
}

function validSessionId(value) {
    return typeof value === 'string' && SESSION_FILE_RE.test(value)
}

function normalizeWorkDir(value) {
    return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '').toLowerCase()
}

function decodedDirectoryWorkDir(encodedDir) {
    const match = String(encodedDir || '').match(/^([A-Za-z])--(.+)$/)
    return match ? `${match[1]}:/${match[2].replace(/-/g, '/')}` : ''
}

// 目录编码是有损的（旧项目目录可能丢失 Unicode），但 transcript 的 cwd
// 保留了原始路径；用同一编码规则重算可以正确处理项目名中的连字符。
function encodedDirectoryWorkDir(workDir) {
    const normalized = String(workDir || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '')
    const match = normalized.match(/^([A-Za-z]):\/(.*)$/)
    return match ? `${match[1]}--${match[2].replace(/\//g, '-')}` : normalized.replace(/\//g, '-')
}

function transcriptWorkDir(filePath) {
    try {
        const lines = readFileSync(filePath, 'utf8').slice(0, 64 * 1024).split('\n')
        for (const line of lines) {
            if (!line.includes('"cwd"')) continue
            try {
                const entry = JSON.parse(line)
                if (typeof entry?.cwd === 'string' && entry.cwd) return normalizeWorkDir(entry.cwd)
            } catch {
                // transcript 可能正写入到半行，继续检查后续完整 JSONL 行。
            }
        }
    } catch {
        return ''
    }
    return ''
}

function transcriptMatchesWorkDir(filePath, requestedEncodedDir, workDir) {
    const explicit = normalizeWorkDir(workDir)
    const actual = transcriptWorkDir(filePath)
    if (explicit) return actual === explicit
    // transcript 有 cwd 时，以真实 cwd 的编码结果为准，避免把项目名中的 `-`
    // 误当成目录分隔符（例如 `znzpxt-yt`）。无 cwd 的旧/半写入 transcript
    // 仍沿用旧的宽松兼容路径。
    if (actual) return encodedDirectoryWorkDir(actual).toLowerCase() === String(requestedEncodedDir || '').toLowerCase()
    const expected = normalizeWorkDir(decodedDirectoryWorkDir(requestedEncodedDir))
    return !expected || !actual || actual === expected
}

function safeTranscriptPath(filePath) {
    try { return statSync(filePath).isFile() ? filePath : null } catch { return null }
}

function candidateWorkDir(filePath) {
    return transcriptWorkDir(filePath)
}

function readTranscriptExcerpt(filePath, maxBytes) {
    const size = statSync(filePath).size
    if (size <= maxBytes) return readFileSync(filePath, 'utf8')
    const headBytes = Math.min(128 * 1024, Math.floor(maxBytes / 3))
    const tailBytes = maxBytes - headBytes
    const head = Buffer.allocUnsafe(headBytes)
    const tail = Buffer.allocUnsafe(tailBytes)
    const fd = openSync(filePath, 'r')
    try {
        const headRead = readSync(fd, head, 0, headBytes, 0)
        const tailRead = readSync(fd, tail, 0, tailBytes, Math.max(0, size - tailBytes))
        return `${head.subarray(0, headRead).toString('utf8')}\n${tail.subarray(0, tailRead).toString('utf8')}`
    } finally {
        closeSync(fd)
    }
}

/**
 * 读取同一工作目录最近的 transcript 摘要候选。兼容旧版 Unicode 编码目录，
 * 并限制候选数和单文件读取量，避免引用性短句阻塞 Gateway。
 */
export function listProjectTranscriptCandidates({
    bridgeHome,
    encodedDir,
    workDir,
    repository = null,
    limit = 24,
    maxBytesPerFile = 512 * 1024,
} = {}) {
    const decodedDir = decodeProjectDirectorySegment(encodedDir)
    if (!decodedDir || !workDir) return []
    const projectsRoot = join(bridgeHome, 'projects')
    if (!existsSync(projectsRoot)) return []
    const requestedProjectDir = join(projectsRoot, decodedDir)
    const sessionRepository = repository
    const indexed = sessionRepository ? sessionRepository.list({projectKey: decodedDir, limit: 500}) : []
    if (indexed.length > 0 && existsSync(requestedProjectDir)) {
        try {
            const diskFiles = new Map(readdirSync(requestedProjectDir)
                .filter(filename => filename.endsWith('.jsonl') && !filename.startsWith('.trash-'))
                .map(filename => [filename.slice(0, -'.jsonl'.length), filename]))
            const candidates = []
            let stale = false
            for (const row of indexed) {
                const filename = diskFiles.get(row.sessionId)
                const filePath = filename ? join(requestedProjectDir, filename) : row.transcriptPath
                if (!filename || !existsSync(filePath)) {
                    sessionRepository.removeByTranscriptPath(row.transcriptPath)
                    stale = true
                    continue
                }
                const stat = statSync(filePath)
                if (!stat.isFile() || stat.mtimeMs !== Number(row.mtime) || stat.size !== Number(row.size) || !transcriptMatchesWorkDir(filePath, decodedDir, workDir)) {
                    sessionRepository.removeByTranscriptPath(row.transcriptPath)
                    stale = true
                    continue
                }
                candidates.push({id: row.sessionId, mtime: stat.mtimeMs, filePath})
            }
            if (!stale && candidates.length === diskFiles.size) {
                return candidates
                    .sort((a, b) => b.mtime - a.mtime)
                    .slice(0, Math.max(1, Math.min(100, Number(limit) || 24)))
                    .map(candidate => {
                        try { return {...candidate, content: readTranscriptExcerpt(candidate.filePath, maxBytesPerFile)} } catch { return null }
                    })
                    .filter(Boolean)
            }
        } catch {
            // 索引损坏或目录正在变化时回退到现有只读扫描。
        }
    }
    const files = []
    const projectEntries = readdirSync(projectsRoot, {withFileTypes: true})
    const candidateDirectories = new Set([decodedDir])
    // 旧版本可能把 Unicode 路径编码成横线。只检查首个 transcript cwd 与当前项目匹配的目录，
    // 不读取所有项目的全部 transcript。
    for (const entry of projectEntries) {
        if (!entry.isDirectory() || entry.name === decodedDir) continue
        const projectDir = join(projectsRoot, entry.name)
        try {
            const recentTranscripts = readdirSync(projectDir)
                .filter(filename => filename.endsWith('.jsonl') && !filename.startsWith('.trash-'))
                .map(filename => ({filename, mtime: statSync(join(projectDir, filename)).mtimeMs}))
                .sort((a, b) => b.mtime - a.mtime)
                .slice(0, 3)
            if (recentTranscripts.some(item => transcriptMatchesWorkDir(join(projectDir, item.filename), decodedDir, workDir))) {
                candidateDirectories.add(entry.name)
            }
        } catch {
            // 损坏或正在变更的项目目录不参与接力候选。
        }
    }
    for (const directoryName of candidateDirectories) {
        const projectDir = join(projectsRoot, directoryName)
        if (!existsSync(projectDir)) continue
        for (const filename of readdirSync(projectDir)) {
            if (!filename.endsWith('.jsonl') || filename.startsWith('.trash-')) continue
            const filePath = join(projectDir, filename)
            try {
                const stat = statSync(filePath)
                if (!stat.isFile() || !transcriptMatchesWorkDir(filePath, decodedDir, workDir)) continue
                files.push({
                    id: filename.slice(0, -'.jsonl'.length),
                    mtime: stat.mtimeMs,
                    filePath,
                })
            } catch {
                // SDK 可能正在轮换或写入 transcript；单个候选失败不阻塞用户消息。
            }
        }
    }
    const result = files
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, Math.max(1, Math.min(100, Number(limit) || 24)))
        .map(candidate => {
            try {
                return {...candidate, content: readTranscriptExcerpt(candidate.filePath, maxBytesPerFile)}
            } catch {
                return null
            }
        })
        .filter(Boolean)
    if (sessionRepository) {
        const currentPaths = new Set(files.map(candidate => candidate.filePath))
        for (const indexedItem of sessionRepository.list({projectKey: decodedDir, limit: 500})) {
            if (!currentPaths.has(indexedItem.transcriptPath)) sessionRepository.removeByTranscriptPath(indexedItem.transcriptPath)
        }
        for (const candidate of files) {
            try {
                const stat = statSync(candidate.filePath)
                sessionRepository.upsert({
                    projectKey: decodedDir,
                    sessionId: candidate.id,
                    workDir,
                    transcriptPath: candidate.filePath,
                    mtime: stat.mtimeMs,
                    size: stat.size,
                })
            } catch {
                // 索引是派生优化，单个文件变化不应阻断 transcript 读取。
            }
        }
    }
    return result
}

/**
 * 定位 transcript。优先使用请求目录；旧版本曾把 Unicode 目录通过 URL 编码传入，
 * 因此在指定目录缺失时按 session ID 做只读兼容查找。
 */
export function findSessionTranscript({bridgeHome, encodedDir, sessionId, workDir}) {
    if (!validSessionId(sessionId)) return {status: 'invalid'}
    const decodedDir = decodeProjectDirectorySegment(encodedDir)
    if (!decodedDir) return {status: 'invalid'}
    const projectsRoot = join(bridgeHome, 'projects')
    const requestedDir = join(projectsRoot, decodedDir)
    const requestedFile = join(requestedDir, `${sessionId}.jsonl`)
    if (existsSync(requestedFile) && statSync(requestedFile).isFile()) {
        if (workDir && !transcriptMatchesWorkDir(requestedFile, decodedDir, workDir)) return {status: 'missing'}
        return {status: 'found', encodedDir: decodedDir, filePath: requestedFile, fallback: false}
    }
    if (!existsSync(projectsRoot)) return {status: 'missing'}
    const matches = []
    for (const entry of readdirSync(projectsRoot, {withFileTypes: true})) {
        if (!entry.isDirectory() || entry.name === decodedDir) continue
        const candidate = join(projectsRoot, entry.name, `${sessionId}.jsonl`)
        if (existsSync(candidate) && statSync(candidate).isFile() && transcriptMatchesWorkDir(candidate, decodedDir, workDir)) {
            matches.push({encodedDir: entry.name, filePath: candidate})
        }
    }
    if (matches.length === 1) return {...matches[0], status: 'found', fallback: true}
    if (matches.length > 1) return {status: 'ambiguous', matches: matches.map(item => item.encodedDir)}
    return {status: 'missing'}
}

/**
 * 以 historySessionId 为主身份解析 transcript。项目提示只用于缩小候选和
 * 权限校验，不能单独决定文件位置；索引陈旧时回退到受限只读扫描。
 */
export function resolveSessionTranscript({bridgeHome, sessionId, projectHint = '', workDir = '', repository = null} = {}) {
    if (!validSessionId(sessionId)) return {status: 'invalid'}
    const hint = projectHint ? decodeProjectDirectorySegment(projectHint) : ''
    if (projectHint && !hint) return {status: 'invalid'}
    const requestedWorkDir = normalizeWorkDir(workDir)
    const projectsRoot = join(bridgeHome, 'projects')
    const matches = new Map()
    const add = (row, source = 'scan') => {
        if (!row?.filePath) return
        const filePath = safeTranscriptPath(row.filePath)
        if (!filePath) return
        const actualWorkDir = candidateWorkDir(filePath) || normalizeWorkDir(row.workDir)
        if (requestedWorkDir && actualWorkDir && actualWorkDir !== requestedWorkDir) return
        // projectHint 不是身份约束；旧目录编码可能与提示不同。若调用方提供
        // workDir，则上面的真实 cwd 校验才是跨项目隔离条件。
        const encodedDir = row.encodedDir || row.projectKey || ''
        if (!encodedDir) return
        matches.set(filePath, {sessionId, encodedDir, workDir: actualWorkDir || requestedWorkDir || '', filePath, source})
    }

    // 索引是同一 session_index 的派生查询；文件仍需存在并重新校验 cwd。
    try {
        const indexedRows = repository?.findBySessionId?.(sessionId) || []
        for (const row of (Array.isArray(indexedRows) ? indexedRows : [indexedRows])) {
            if (!row) continue
            const indexedPath = safeTranscriptPath(row.transcriptPath)
            if (!indexedPath
                || (row.mtime != null && Number(statSync(indexedPath).mtimeMs) !== Number(row.mtime))
                || (row.size != null && Number(statSync(indexedPath).size) !== Number(row.size))) {
                if (row.transcriptPath) repository?.removeByTranscriptPath?.(row.transcriptPath)
                continue
            }
            add({
                ...row,
                encodedDir: row.projectKey,
                filePath: indexedPath,
                workDir: row.workDir,
            }, 'index')
        }
    } catch {
        // 索引不可用时继续只读回查，不能阻断历史恢复。
    }

    if (existsSync(projectsRoot)) {
        const directories = []
        try {
            for (const entry of readdirSync(projectsRoot, {withFileTypes: true})) {
                if (!entry.isDirectory()) continue
                if (hint && entry.name === hint) directories.unshift(entry.name)
                else directories.push(entry.name)
            }
        } catch {
            return matches.size === 1 ? {status: 'found', ...matches.values().next().value} : matches.size > 1 ? {status: 'ambiguous', matches: [...matches.values()].map(({encodedDir, filePath}) => ({encodedDir, filePath}))} : {status: 'missing'}
        }
        for (const directoryName of directories) {
            const projectDir = join(projectsRoot, directoryName)
            const candidateIds = new Set([sessionId])
            try {
                const sessionMap = JSON.parse(readFileSync(join(projectDir, 'bridge-session-map.json'), 'utf8'))
                const mapped = sessionMap?.[sessionId]
                if (validSessionId(mapped)) candidateIds.add(mapped)
                const reverseMapped = sessionMap?.[`@rev:${sessionId}`]
                if (validSessionId(reverseMapped)) candidateIds.add(reverseMapped)
            } catch {
                // Session map 缺失或正在写入时直接按 transcript ID 检查。
            }
            for (const candidateId of candidateIds) {
                const filePath = join(projectDir, `${candidateId}.jsonl`)
                add({encodedDir: directoryName, filePath}, candidateId === sessionId ? 'scan' : 'session-map')
            }
        }
    }
    if (matches.size === 1) return {status: 'found', ...matches.values().next().value}
    if (matches.size > 1) return {status: 'ambiguous', matches: [...matches.values()].map(({encodedDir, filePath}) => ({encodedDir, filePath}))}
    return {status: 'missing'}
}
