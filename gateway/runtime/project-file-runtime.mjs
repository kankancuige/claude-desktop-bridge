import {relative, join} from 'node:path'

/**
 * 项目文件端口。
 *
 * 统一拥有工作区扫描、Git 文件清单、快照和 Diff 算法。调用方只依赖
 * 返回的结构化端口，不直接接触文件系统或 Git 命令，从而让组合根不再
 * 承担文件领域实现。
 */
export function createProjectFileRuntime({
    existsSync,
    readdirSync,
    statSync,
    readFileSync,
    execSync,
    safeChildPath,
    relativePath = relative,
    joinPath = join,
    logger = {debug() {}},
    maxFiles = MAX_SNAP_FILES,
    maxFileBytes = MAX_SNAP_FILE_BYTES,
    excludeDirs = SNAP_EXCLUDE_DIRS,
    binaryExtensions = BINARY_EXTS,
} = {}) {
    if ([existsSync, readdirSync, statSync, readFileSync, execSync, safeChildPath].some(fn => typeof fn !== 'function')) {
        throw new TypeError('project file dependencies are required')
    }

    function isBinaryPath(path) {
        const dot = path.lastIndexOf('.')
        return dot >= 0 && binaryExtensions.has(path.slice(dot).toLowerCase())
    }

    function resolveSafe(workDir, relPath) {
        return safeChildPath(workDir, relPath, {allowNested: true})
    }

    function scanWorkdirFiles(workDir) {
        const files = []
        let truncated = false
        if (!existsSync(workDir)) return {files, truncated, missing: true}
        const stack = [workDir]
        while (stack.length) {
            if (files.length >= maxFiles) {
                truncated = true
                break
            }
            const dir = stack.pop()
            let entries
            try {
                entries = readdirSync(dir, {withFileTypes: true})
            } catch (error) {
                logger.debug({err: error, path: dir}, '扫描项目目录失败，已跳过')
                continue
            }
            for (const ent of entries) {
                const full = joinPath(dir, ent.name)
                if (ent.isDirectory()) {
                    if (!excludeDirs.has(ent.name)) stack.push(full)
                    continue
                }
                if (!ent.isFile()) continue
                if (files.length >= maxFiles) {
                    truncated = true
                    break
                }
                let size = 0
                let mtimeMs = 0
                try {
                    const stat = statSync(full)
                    size = stat.size
                    mtimeMs = stat.mtimeMs
                } catch (error) {
                    logger.debug({err: error, path: full}, '读取文件元数据失败，已按降级路径继续')
                }
                const path = relativePath(workDir, full).replace(/\\/g, '/')
                files.push({path, size, mtimeMs, binary: isBinaryPath(path)})
            }
        }
        return {files, truncated, missing: false}
    }

    function getGitHead(workDir) {
        try {
            const branch = execSync('git rev-parse --abbrev-ref HEAD', {cwd: workDir, encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe']}).trim()
            const hash = execSync('git rev-parse HEAD', {cwd: workDir, encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe']}).trim()
            return {branch, hash, shortHash: hash.slice(0, 7)}
        } catch (error) {
            logger.debug({err: error, workDir}, '读取 Git HEAD 失败')
            return null
        }
    }

    function scanGitFiles(workDir) {
        try {
            const out = execSync('git ls-files --cached --others --exclude-standard --full-name -z', {
                cwd: workDir, encoding: 'utf8', timeout: 10000,
                maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']
            })
            const files = []
            for (const raw of out.split('\0')) {
                if (files.length >= maxFiles) break
                const path = raw.trim()
                if (!path) continue
                const topDir = path.split('/')[0]
                if (excludeDirs.has(topDir)) continue
                try {
                    const stat = statSync(joinPath(workDir, path))
                    if (!stat.isFile()) continue
                    files.push({path: path.replace(/\\/g, '/'), size: stat.size, mtimeMs: stat.mtimeMs, binary: isBinaryPath(path)})
                } catch (error) {
                    logger.debug({err: error, path}, 'Git 文件已删除或无法读取，已跳过')
                }
            }
            return {files, truncated: files.length >= maxFiles, missing: false}
        } catch (error) {
            logger.debug({err: error, workDir}, '读取 Git 文件清单失败')
            return null
        }
    }

    function buildGitSnapshot(workDir, baseline) {
        const gitHead = getGitHead(workDir)
        if (!gitHead) return null
        const scan = scanGitFiles(workDir)
        if (!scan) return null
        const map = new Map()
        const baseFiles = baseline?.files
        for (const file of scan.files) {
            if (file.binary) {
                map.set(file.path, {binary: true, size: file.size})
                continue
            }
            if (file.size > maxFileBytes) {
                map.set(file.path, {binary: false, tooLarge: true, size: file.size})
                continue
            }
            const previous = baseFiles?.get(file.path)
            if (previous && !previous.readError && !previous.tooLarge && previous.size === file.size
                && previous.mtimeMs === file.mtimeMs && typeof previous.content === 'string') {
                map.set(file.path, previous)
                continue
            }
            try {
                const content = readFileSync(joinPath(workDir, file.path), 'utf8')
                map.set(file.path, {binary: false, content, size: file.size, mtimeMs: file.mtimeMs, lines: content.length ? content.split('\n').length : 0})
            } catch (error) {
                logger.debug({err: error, path: file.path}, '读取 Git 文件内容失败')
                map.set(file.path, {binary: false, readError: true, size: file.size, mtimeMs: file.mtimeMs})
            }
        }
        return {takenAt: Date.now(), files: map, truncated: scan.truncated, gitHead}
    }

    function buildFileSnapshot(workDir, baseline) {
        const gitSnapshot = buildGitSnapshot(workDir, baseline)
        if (gitSnapshot) return gitSnapshot
        const scan = scanWorkdirFiles(workDir)
        const map = new Map()
        const baseFiles = baseline?.files
        for (const file of scan.files) {
            if (file.binary) {
                map.set(file.path, {binary: true, size: file.size})
                continue
            }
            if (file.size > maxFileBytes) {
                map.set(file.path, {binary: false, tooLarge: true, size: file.size})
                continue
            }
            const previous = baseFiles?.get(file.path)
            if (previous && !previous.readError && !previous.tooLarge && previous.size === file.size
                && previous.mtimeMs === file.mtimeMs && typeof previous.content === 'string') {
                map.set(file.path, previous)
                continue
            }
            try {
                const content = readFileSync(joinPath(workDir, file.path), 'utf8')
                map.set(file.path, {binary: false, content, size: file.size, mtimeMs: file.mtimeMs, lines: content.length ? content.split('\n').length : 0})
            } catch (error) {
                logger.debug({err: error, path: file.path}, '读取项目文件内容失败')
                map.set(file.path, {binary: false, readError: true, size: file.size, mtimeMs: file.mtimeMs})
            }
        }
        return {takenAt: Date.now(), files: map, truncated: scan.truncated}
    }

    function currentFileScan(workDir, snapshot) {
        if (snapshot?.gitHead) {
            const scan = scanGitFiles(workDir)
            if (scan) return scan
        }
        return scanWorkdirFiles(workDir)
    }

    function lcsLength(a, b) {
        if (a.length === 0 || b.length === 0) return 0
        if (b.length > a.length) [a, b] = [b, a]
        const m = b.length
        let previous = new Array(m + 1).fill(0)
        let current = new Array(m + 1).fill(0)
        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= m; j++) current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1])
            ;[previous, current] = [current, previous]
            current.fill(0)
        }
        return previous[m]
    }

    function lineDiffStats(oldStr, newStr) {
        const oldLines = oldStr.length ? oldStr.split('\n') : []
        const newLines = newStr.length ? newStr.split('\n') : []
        const common = lcsLength(oldLines, newLines)
        return {added: newLines.length - common, removed: oldLines.length - common}
    }

    function computeLineDiff(oldStr, newStr) {
        const oldLines = oldStr.length ? oldStr.split('\n') : []
        const newLines = newStr.length ? newStr.split('\n') : []
        if (oldLines.length * newLines.length > 4_000_000) return {tooLarge: true}
        const n = oldLines.length, m = newLines.length
        const dp = Array.from({length: n + 1}, () => new Int32Array(m + 1))
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
        }
        const lines = []
        let i = 0, j = 0, oldNo = 1, newNo = 1
        while (i < n && j < m) {
            if (oldLines[i] === newLines[j]) lines.push({type: 'context', oldNo: oldNo++, newNo: newNo++, text: oldLines[i]}), i++, j++
            else if (dp[i + 1][j] >= dp[i][j + 1]) lines.push({type: 'del', oldNo: oldNo++, newNo: null, text: oldLines[i]}), i++
            else lines.push({type: 'add', oldNo: null, newNo: newNo++, text: newLines[j]}), j++
        }
        while (i < n) lines.push({type: 'del', oldNo: oldNo++, newNo: null, text: oldLines[i++]} )
        while (j < m) lines.push({type: 'add', oldNo: null, newNo: newNo++, text: newLines[j++]} )
        return {lines}
    }

    function diffSnapshotVsCurrent(snapshot, currentFiles, workDir) {
        const result = new Map()
        const snapFiles = snapshot.files
        const seen = new Set()
        for (const file of currentFiles) {
            seen.add(file.path)
            const snap = snapFiles.get(file.path)
            if (!snap) {
                result.set(file.path, {status: 'added', binary: file.binary, added: null, removed: 0})
                continue
            }
            if (file.binary || snap.binary) {
                result.set(file.path, {status: snap.size !== file.size ? 'modified' : 'unchanged', binary: true, added: null, removed: null})
                continue
            }
            if (snap.tooLarge || snap.readError) {
                result.set(file.path, {status: snap.size !== file.size ? 'modified' : 'unchanged', binary: false, added: null, removed: null})
                continue
            }
            let current = null
            try {
                if (file.size <= maxFileBytes) current = readFileSync(joinPath(workDir, file.path), 'utf8')
            } catch (error) {
                logger.debug({err: error, path: file.path}, '读取当前文件内容失败')
            }
            if (current == null) result.set(file.path, {status: snap.size !== file.size ? 'modified' : 'unchanged', binary: false, added: null, removed: null})
            else if (current === snap.content) result.set(file.path, {status: 'unchanged', binary: false, added: 0, removed: 0})
            else {
                const stats = lineDiffStats(snap.content, current)
                result.set(file.path, {status: 'modified', binary: false, added: stats.added, removed: stats.removed})
            }
        }
        for (const [path, snap] of snapFiles) {
            if (!seen.has(path)) result.set(path, {status: 'deleted', binary: !!snap.binary, added: 0, removed: snap.lines ?? null})
        }
        return result
    }

    return {isBinaryPath, resolveSafe, scanWorkdirFiles, scanGitFiles, getGitHead, currentFileScan,
        buildGitSnapshot, buildFileSnapshot, lcsLength, lineDiffStats, computeLineDiff, diffSnapshotVsCurrent}
}

export const SNAP_EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', '.cache', '.vscode', '.idea', 'coverage', '.nuxt', '.output', '.turbo', 'target', '__pycache__', '.venv', 'venv'])
export const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf', '.zip', '.gz', '.tar', '.7z', '.exe', '.dll', '.so', '.dylib', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.mp4', '.mov', '.wav', '.webm', '.class', '.jar', '.pyc', '.wasm', '.node', '.bin'])
export const MAX_SNAP_FILE_BYTES = 512 * 1024
export const MAX_SNAP_FILES = 5000
