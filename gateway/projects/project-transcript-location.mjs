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
    const expected = normalizeWorkDir(decodedDirectoryWorkDir(requestedEncodedDir))
    const actual = transcriptWorkDir(filePath)
    if (explicit) return actual === explicit
    if (!expected) return true
    return !actual || actual === expected
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
