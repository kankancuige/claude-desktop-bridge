/** Caveman/RTK 版本、安装和 PostToolUse 压缩运行时。 */
export function createToolingUpdateRuntime(deps = {}) {
    const {
        BRIDGE_HOME, __dirname, dynamicCache, persistDynamicCache, loadCliSettingsForUpdate,
        readJSON, writeJSON, existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync,
        renameSync, resolve, join, dirname, homedir, spawn, spawnSync, statSync,
        resolveRtkCommandArgs, selectRtkReleaseAsset, verifyRtkAssetDigest,
        buildWindowsRtkExtractArgs, buildWindowsRtkExtractEnv, logger = console,
        maxRemoteTextBytes = 2 * 1024 * 1024,
    } = deps
    const log = logger

// ── Caveman skill 内置安装 + 配置 ──
// 功能说明: 确保 ~/.claude-desktop-bridge/skills/caveman/SKILL.md 存在，不存在则从内置模板写入
//   配置存 settings.json → caveman: {enabled, level}，默认开启 full 级别
// SIDE_EFFECT: 写入 ~/.claude-desktop-bridge/skills/caveman/SKILL.md（首次）
const CAVEMAN_SKILL_DIR = join(BRIDGE_HOME, 'skills', 'caveman')
const CAVEMAN_SKILL_FILE = join(CAVEMAN_SKILL_DIR, 'SKILL.md')
const CAVEMAN_VERSION_FILE = join(CAVEMAN_SKILL_DIR, 'VERSION')
const CAVEMAN_DEFAULT_CONFIG = {enabled: true, level: 'full'}
const CAVEMAN_VALID_LEVELS = ['lite', 'full', 'ultra', 'wenyan']

// ── 语义化版本号提取（从 v0.43.0 / dev-0.43.0-rc.292 等标签中提取 [major, minor, patch]）──
function extractSemver(tag) {
    const m = tag.match(/(\d+)\.(\d+)\.(\d+)/)
    if (!m) return null
    return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])]
}
function compareSemver(a, b) {
    if (!a && !b) return 0
    if (!a) return -1  // 无法解析视为旧版本
    if (!b) return 1
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] - b[i]
    }
    return 0
}

// ── Caveman 版本检查（启动时调 GitHub API）──
async function checkCavemanUpdate() {
    let current = 'builtin'
    try {
        if (existsSync(CAVEMAN_VERSION_FILE)) current = readFileSync(CAVEMAN_VERSION_FILE, 'utf8').trim()
    } catch (error) {
        log.debug({err: error, path: CAVEMAN_VERSION_FILE}, '读取 Caveman 版本文件失败')
    }
    dynamicCache.cavemanCurrent = current
    try {
        const resp = await fetch('https://api.github.com/repos/JuliusBrussee/caveman/releases?per_page=5', {
            signal: AbortSignal.timeout(30000)
        })
        if (!resp.ok) { log.warn({status: resp.status}, 'Caveman releases 获取失败'); return }
        const releases = await resp.json()
        if (!Array.isArray(releases) || !releases.length) return
        const latest = releases[0].tag_name || ''
        dynamicCache.cavemanReleases = releases.map(r => ({
            tag: r.tag_name,
            name: r.name || r.tag_name,
            publishedAt: r.published_at,
        }))
        const curSemver = extractSemver(current)
        if (latest && compareSemver(curSemver, extractSemver(latest)) < 0) {
            dynamicCache.cavemanUpdate = {current, latest, checkedAt: new Date().toISOString()}
            log.info({current, latest}, 'Caveman 有新版本可用')
        } else {
            dynamicCache.cavemanUpdate = null  // 清除旧缓存，避免残留更新提示
        }
        persistDynamicCache()
    } catch (e) {
        log.info({err: e}, 'Caveman 版本检查网络异常（非关键）')
    }
}

// ── Caveman SKILL.md 更新（下载指定版本替换）──
async function downloadAndReplaceCaveman(targetVersion) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(targetVersion)) throw new Error('Caveman 版本号格式不合法')
    const skillUrl = `https://raw.githubusercontent.com/JuliusBrussee/caveman/${targetVersion}/skills/caveman/SKILL.md`
    log.info({version: targetVersion, url: skillUrl}, 'Caveman 开始下载')
    const resp = await fetch(skillUrl, {signal: AbortSignal.timeout(30000)})
    if (!resp.ok) throw new Error(`下载失败 ${resp.status}`)
    const content = (await readFetchBodyLimited(resp, MAX_REMOTE_TEXT_BYTES)).toString('utf8')
    if (!content.trim()) throw new Error('下载内容为空')
    mkdirSync(CAVEMAN_SKILL_DIR, {recursive: true})
    // 备份旧文件
    if (existsSync(CAVEMAN_SKILL_FILE)) {
        writeFileSync(CAVEMAN_SKILL_FILE + '.bak', readFileSync(CAVEMAN_SKILL_FILE, 'utf8'), 'utf8')
    }
    writeFileSync(CAVEMAN_SKILL_FILE, content, 'utf8')
    writeFileSync(CAVEMAN_VERSION_FILE, targetVersion, 'utf8')
    dynamicCache.cavemanCurrent = targetVersion
    dynamicCache.cavemanUpdate = null
    persistDynamicCache()
    log.info({version: targetVersion}, 'Caveman 更新完成')
}

function loadCavemanConfig() {
    const s = readJSON(join(BRIDGE_HOME, 'settings.json')) || {}
    const c = s.caveman
    if (c && typeof c === 'object' && typeof c.enabled === 'boolean' && CAVEMAN_VALID_LEVELS.includes(c.level)) {
        return c
    }
    return {...CAVEMAN_DEFAULT_CONFIG}
}

function saveCavemanConfig(cfg) {
    const s = loadCliSettingsForUpdate()
    s.caveman = cfg
    writeJSON(join(BRIDGE_HOME, 'settings.json'), s)
}

// ── Caveman 系统提示词生成（会话级 systemPrompt.append 注入，不污染任何 CLAUDE.md）──
function buildCavemanSystemPrompt(cfg) {
    if (!cfg || !cfg.enabled || !cfg.level) return null
    const base = 'Use caveman compression (level: ' + cfg.level + '): drop filler/hedging/articles, use fragments and short synonyms. Keep all technical substance, code, error strings exact. No emoji, no tool-call narration. Speak user\'s language. Resume normal style for security warnings and destructive actions.'
    if (cfg.level === 'wenyan' || cfg.level.startsWith('wenyan')) {
        return base + ' Use classical Chinese (文言文) style.'
    }
    return base
}

// ── RTK 二进制定位 + 版本检查 + 配置 ──
// 功能说明: rtk（MIT）是 Rust 命令行压缩工具，bridge 打包内置，PostToolUse hook 调用
//   开发环境从 ../rtk-bin/ 找；生产环境从 process.resourcesPath/rtk/ 找
//   配置存 settings.json → bashCompress: {enabled}
//   版本检查: 启动时调 GitHub API 对比本地 version.txt，有更新写入 dynamicCache 供前端显示
// SIDE_EFFECT: 启动时调 GitHub API（checkRtkUpdate）→ 写入 dynamicCache.rtkUpdate → persistDynamicCache()
const RTK_TIMEOUT = 5000  // rtk 进程超时（ms）
const RTK_REJECT_RATIO = 0.95  // 压缩比 > 95% → 驳回
const RTK_CRITICAL_PATTERN = /fatal|panic|denied|segfault|corruption/i  // 致命关键词
const MAX_RTK_ARCHIVE_BYTES = 100 * 1024 * 1024
const MAX_REMOTE_TEXT_BYTES = 2 * 1024 * 1024

async function readFetchBodyLimited(response, maxBytes) {
    const declared = Number(response.headers.get('content-length') || 0)
    if (Number.isFinite(declared) && declared > maxBytes) {
        try { await response.body?.cancel() } catch (cancelError) {
            log.debug({err: cancelError}, '取消声明长度超限的下载流失败')
        }
        throw new Error('下载文件超过大小限制')
    }
    if (!response.body) return Buffer.alloc(0)
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    try {
        while (true) {
            const {done, value} = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > maxBytes) throw new Error('下载文件超过大小限制')
            chunks.push(Buffer.from(value))
        }
    } catch (error) {
        try { await reader.cancel(error) } catch (cancelError) {
            log.debug({err: cancelError}, '取消超限下载流失败')
        }
        throw error
    } finally {
        reader.releaseLock()
    }
    return Buffer.concat(chunks, total)
}

function locateRtk() {
    const plat = process.platform
    const arch = process.arch
    const map = {
        'win32-x64': 'rtk-x86_64-pc-windows-msvc.exe',
        'linux-x64': 'rtk-x86_64-unknown-linux-gnu',
        'darwin-x64': 'rtk-x86_64-apple-darwin',
        'darwin-arm64': 'rtk-aarch64-apple-darwin',
    }
    const name = map[`${plat}-${arch}`]
    if (!name) return null
    // rtk 在 gateway 同级目录：开发 rtk-bin/，生产打包 rtk/（extraResources.to）
    for (const dir of ['rtk-bin', 'rtk']) {
        const p = resolve(__dirname, '..', dir, name)
        if (existsSync(p)) return p
    }
    return null
}

function getRtkDir() {
    for (const dir of ['rtk-bin', 'rtk']) {
        const d = resolve(__dirname, '..', dir)
        if (existsSync(d)) return d
    }
    return resolve(__dirname, '..', 'rtk-bin')  // 默认，后续创建
}

function loadRtkConfig() {
    const s = readJSON(join(BRIDGE_HOME, 'settings.json')) || {}
    const c = s.bashCompress
    if (c && typeof c === 'object' && typeof c.enabled === 'boolean') return c
    return {enabled: true}
}

function saveRtkConfig(cfg) {
    const s = loadCliSettingsForUpdate()
    s.bashCompress = cfg
    writeJSON(join(BRIDGE_HOME, 'settings.json'), s)
}

async function checkRtkUpdate() {
    const rtkDir = getRtkDir()
    const versionFile = join(rtkDir, 'version.txt')
    let current = 'unknown'
    try {
        if (existsSync(versionFile)) current = readFileSync(versionFile, 'utf8').trim()
    } catch (error) {
        log.debug({err: error, path: versionFile}, '读取 RTK 版本文件失败')
    }
    // 持久化当前版本号供前端显示
    dynamicCache.rtkCurrent = current
    try {
        const resp = await fetch('https://api.github.com/repos/rtk-ai/rtk/releases?per_page=5', {
            signal: AbortSignal.timeout(30000)
        })
        if (!resp.ok) { log.warn({status: resp.status}, 'RTK releases 获取失败'); return }
        const releases = await resp.json()
        if (!Array.isArray(releases) || !releases.length) return
        const latest = releases[0].tag_name || ''
        // 缓存可用版本列表供前端选择（保留全部版本）
        dynamicCache.rtkReleases = releases.map(r => ({
            tag: r.tag_name,
            name: r.name || r.tag_name,
            publishedAt: r.published_at,
        }))
        const rtkSemver = extractSemver(current)
        if (latest && compareSemver(rtkSemver, extractSemver(latest)) < 0) {
            dynamicCache.rtkUpdate = {current, latest, checkedAt: new Date().toISOString()}
            log.info({current, latest}, 'RTK 有新版本可用')
        } else {
            dynamicCache.rtkUpdate = null  // 清除旧缓存，避免残留更新提示
        }
        persistDynamicCache()
    } catch (e) {
        log.info({err: e}, 'RTK 版本检查网络异常（非关键）')
    }
}

// ── RTK 二进制更新（下载 + 替换）──
// 功能说明: 从 GitHub 下载指定版本的 RTK 二进制，解压替换本地文件，更新 version.txt
//   仅支持 Windows (.zip) 和 Linux/macOS (.tar.gz)
// SIDE_EFFECT: 覆盖 rtk-bin/ 或 resources/rtk/ 下的二进制 + version.txt
async function downloadAndReplaceRtk(targetVersion) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(targetVersion)) throw new Error('RTK 版本号格式不合法')
    const plat = process.platform
    const arch = process.arch
    const binName = {
        'win32-x64': 'rtk-x86_64-pc-windows-msvc.exe',
        'linux-x64': 'rtk-x86_64-unknown-linux-gnu',
        'darwin-x64': 'rtk-x86_64-apple-darwin',
        'darwin-arm64': 'rtk-aarch64-apple-darwin',
    }[`${plat}-${arch}`]
    if (!binName) throw new Error(`不支持的平台: ${plat}-${arch}`)

    const rtkDir = getRtkDir()
    mkdirSync(rtkDir, {recursive: true})

    // 1. 获取 release 详情找到下载 URL
    const releaseResp = await fetch(`https://api.github.com/repos/rtk-ai/rtk/releases/tags/${targetVersion}`, {
        signal: AbortSignal.timeout(30000)
    })
    if (!releaseResp.ok) throw new Error(`GitHub API 返回 ${releaseResp.status}`)
    const release = await releaseResp.json()
    const asset = selectRtkReleaseAsset(release.assets, binName, plat)
    const downloadUrl = asset.browser_download_url
    // 校验下载 URL 必须是 GitHub 域名（防止 GitHub API 响应被污染时 SSRF）
    let parsedDownloadUrl
    try { parsedDownloadUrl = new URL(downloadUrl) } catch { throw new Error('RTK 下载链接格式不合法') }
    if (parsedDownloadUrl.protocol !== 'https:' || parsedDownloadUrl.hostname.toLowerCase() !== 'github.com') {
        throw new Error('RTK 下载链接域名不合法')
    }

    // 2. 下载到临时文件
    log.info({version: targetVersion, url: downloadUrl}, 'RTK 开始下载')
    const tmpFile = join(rtkDir, `_rtk_download${plat === 'win32' ? '.zip' : '.tar.gz'}`)
    const dlResp = await fetch(downloadUrl, {signal: AbortSignal.timeout(120000)})
    if (!dlResp.ok) throw new Error(`下载失败 ${dlResp.status}`)
    const buf = await readFetchBodyLimited(dlResp, MAX_RTK_ARCHIVE_BYTES)
    const digest = verifyRtkAssetDigest(buf, asset.digest)
    writeFileSync(tmpFile, buf)
    log.info({version: targetVersion, size: buf.length, sha256: digest}, 'RTK 下载完成并通过哈希校验')

    // 3. 解压
    const dest = join(rtkDir, binName)
    const pendingDest = dest + '.new'
    const backupDest = dest + '.bak'
    try {
        if (existsSync(pendingDest)) unlinkSync(pendingDest)
        if (plat === 'win32') {
            const psResult = spawnSync('powershell.exe', buildWindowsRtkExtractArgs(), {
                timeout: 30000,
                windowsHide: true,
                env: buildWindowsRtkExtractEnv(tmpFile, pendingDest),
            })
            if (psResult.error) throw new Error(`解压失败: ${psResult.error.message}`)
            if (psResult.status !== 0 || !existsSync(pendingDest)) throw new Error('解压后未找到 rtk.exe')
        } else {
            const listResult = spawnSync('tar', ['-tzf', tmpFile], {
                timeout: 30000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
            })
            if (listResult.error || listResult.status !== 0) {
                throw new Error(`读取归档目录失败: ${listResult.error?.message || listResult.stderr || listResult.status}`)
            }
            const entries = listResult.stdout.split(/\r?\n/).filter(Boolean)
            if (entries.some(entry => entry.startsWith('/') || entry.split('/').some(segment => segment === '..'))) {
                throw new Error('RTK 归档包含非法路径')
            }
            const binaryEntry = entries.find(entry => entry.split('/').pop() === binName)
            if (!binaryEntry) throw new Error(`归档中未找到 ${binName}`)
            const extractResult = spawnSync('tar', ['-xOzf', tmpFile, binaryEntry], {
                timeout: 30000, encoding: null, maxBuffer: MAX_RTK_ARCHIVE_BYTES,
            })
            if (extractResult.error || extractResult.status !== 0 || !extractResult.stdout?.length) {
                throw new Error(`提取二进制失败: ${extractResult.error?.message || extractResult.stderr?.toString() || extractResult.status}`)
            }
            writeFileSync(pendingDest, extractResult.stdout)
        }
        if (plat !== 'win32') {
            const chmodResult = spawnSync('chmod', ['+x', pendingDest], {timeout: 5000})
            if (chmodResult.error || chmodResult.status !== 0) throw new Error('设置 RTK 可执行权限失败')
        }
        if (existsSync(backupDest)) unlinkSync(backupDest)
        if (existsSync(dest)) renameSync(dest, backupDest)
        try {
            renameSync(pendingDest, dest)
        } catch (error) {
            if (existsSync(backupDest) && !existsSync(dest)) renameSync(backupDest, dest)
            throw error
        }
        if (existsSync(backupDest)) unlinkSync(backupDest)
    } finally {
        if (existsSync(tmpFile)) unlinkSync(tmpFile)
        if (existsSync(pendingDest)) unlinkSync(pendingDest)
    }

    // 4. 更新 version.txt
    writeFileSync(join(rtkDir, 'version.txt'), targetVersion, 'utf8')
    dynamicCache.rtkCurrent = targetVersion

    // 5. 清除更新提示（版本列表保留，供后续切换）
    dynamicCache.rtkUpdate = null
    persistDynamicCache()
    log.info({version: targetVersion}, 'RTK 更新完成')
}

// ── RTK PostToolUse hook 处理器 ──
// 功能说明: 拦截 Bash 工具的结果，将 stdout 通过 rtk pipe 管道压缩后替换 tool_response
//   含两道安全检查：压缩比异常 → 驳回；致命关键词漏网 → 驳回
//   失败/超时/不可用 → 静默降级，原样返回
// 实现方式: spawn rtk pipe → stdin 写入 stdout 原文 → 收集输出 → 检查 → updatedMCPToolOutput
// 关键数据流: tool_response → spawn rtk pipe → 压缩结果 → 安全检查 → {continue: true, hookSpecificOutput}
//   或 驳回/降级 → {continue: true}（不修改 tool_response）
async function rtkPostToolUseHandler(input, _toolUseID, _options) {
    const rtkPath = locateRtk()
    if (!rtkPath) return {continue: true}
    const cfg = loadRtkConfig()
    if (!cfg.enabled) return {continue: true}
    if (input.tool_name !== 'Bash') return {continue: true}

    const response = input.tool_response
    // 判断是否为结构化结果（SDK 返回 {stdout, stderr, exitCode, ...}），非结构化则跳过
    if (!response || typeof response !== 'object') return {continue: true}
    const {stdout, stderr, exitCode} = response
    const original = (stdout || '') + (stderr ? '\n' + stderr : '')
    if (!original.trim()) return {continue: true}
    // exitCode ≠ 0 → 失败命令不压缩
    if (exitCode !== undefined && exitCode !== 0) return {continue: true}

    // 获取原命令文本（从 tool_input 中取）
    const cmd = (input.tool_input && typeof input.tool_input === 'object' && input.tool_input.command)
        ? String(input.tool_input.command)
        : ''

    // RTK 会重新执行命令来获取压缩输出，仅对只读命令安全
    if (!isReadOnlyCommand(cmd)) return {continue: true}

    // 调用 rtk 压缩
    let compressed = null
    try {
        compressed = await spawnRtk(rtkPath, cmd, original)
    } catch (e) {
        log.warn({err: e, sessionId: input.session_id?.slice(0, 8)}, 'RTK 压缩失败，降级为原样')
        return {continue: true}
    }
    if (!compressed) return {continue: true}

    // ── bridge 安全检查层 ──
    const originalLen = Buffer.byteLength(original, 'utf8')
    const compressedLen = Buffer.byteLength(compressed, 'utf8')
    // 检查1: 压缩比异常（砍掉 95%+）
    if (originalLen > 0 && (compressedLen / originalLen) < (1 - RTK_REJECT_RATIO)) {
        log.warn({sessionId: input.session_id?.slice(0, 8), originalLen, compressedLen,
            ratio: (compressedLen / originalLen).toFixed(3)}, 'RTK 压缩比异常，驳回')
        return {continue: true}
    }
    // 检查2: 致命关键词漏网（被删除部分含致命关键词）
    if (RTK_CRITICAL_PATTERN.test(original) && !RTK_CRITICAL_PATTERN.test(compressed)) {
        log.warn({sessionId: input.session_id?.slice(0, 8)}, 'RTK 丢弃部分含致命关键词，驳回')
        return {continue: true}
    }

    const savedPct = originalLen > 0 ? Math.round((1 - compressedLen / originalLen) * 100) : 0
    log.info({sessionId: input.session_id?.slice(0, 8), originalLen, compressedLen, savedPct},
        `RTK 压缩 — ${originalLen}→${compressedLen} 字节 节省${savedPct}%`)

    return {
        continue: true,
        hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            updatedMCPToolOutput: {...response, stdout: compressed, stderr: ''}
        }
    }
}

// ── 启动 rtk 子进程并收集输出 ──
// 功能说明: spawn rtk，stdin 传入要压缩的文本，收集 stdout 返回压缩结果
// 实现方式: child_process.spawn → stdin.write + stdin.end → 拼接 stdout chunks
//   5 秒超时，任何异常（崩溃/超时/spawn 失败）抛给调用方
// ── parseShellArgs — 将 shell 命令字符串拆分为 argv 数组 ──
// 处理引号、转义；忽略管道和重定向之后的部分
function parseShellArgs(cmd) {
    const args = []
    let cur = ''
    let quote = ''
    for (let i = 0; i < cmd.length; i++) {
        const ch = cmd[i]
        if (quote) {
            if (ch === '\\' && quote === '"' && i + 1 < cmd.length) {
                cur += cmd[++i]
            } else if (ch === quote) {
                quote = ''
            } else {
                cur += ch
            }
        } else if (ch === '"' || ch === "'") {
            quote = ch
        } else if (ch === ' ' || ch === '\t') {
            if (cur) { args.push(cur); cur = '' }
        } else if (ch === '|' || ch === '>' || ch === '&') {
            // 管道/重定向/后台: 截断后续
            if (cur) args.push(cur)
            return args
        } else {
            cur += ch
        }
    }
    if (cur) args.push(cur)
    return args
}

// ── RTK 安全: 只读命令白名单，防止重执行时产生副作用 ──
// 按平台拆分：Windows 仅包含原生支持 + 跨平台工具，Unix 额外包含 Unix-only 命令
const RTK_READONLY_CROSS = [
    'echo', 'dir', 'tree', 'hostname', 'whoami',
    'git log', 'git diff', 'git show', 'git status', 'git branch', 'git tag',
    'git stash list', 'git remote', 'git config',
    'node -e', 'node -p', 'python -c',
    'npm view', 'npm list', 'npm ls', 'npm outdated',
    'dotnet --list', 'dotnet --info', 'cargo search', 'cargo tree',
    'npx --help', 'npx -v', 'rg',
]
const RTK_READONLY_UNIX = [
    'wc', 'grep', 'ls', 'cat', 'head', 'tail', 'uniq', 'cut', 'tr',
    'awk', 'sed', 'printf', 'env', 'printenv', 'pwd', 'uname', 'which',
    'file', 'stat', 'du', 'df', 'read', 'type', 'find', 'sort', 'date',
]
// Windows: 仅跨平台；Unix: 跨平台 + Unix-only
const RTK_READONLY_PREFIXES = process.platform === 'win32'
    ? RTK_READONLY_CROSS
    : [...RTK_READONLY_CROSS, ...RTK_READONLY_UNIX]

function isReadOnlyCommand(cmd) {
    if (!cmd || typeof cmd !== 'string') return false
    const lower = cmd.trim().toLowerCase()
    for (const prefix of RTK_READONLY_PREFIXES) {
        if (lower.startsWith(prefix)) return true
    }
    return false
}

// ── findGitBashDirs — 动态探测 Windows 上 Git Bash 的 bin 目录 ──
// 用 where.exe git 定位 git.exe，反向推导 /usr/bin；失败则回退常见路径
function findGitBashDirs() {
    const dirs = []
    try {
        const result = spawnSync('where', ['git'], {timeout: 3000, encoding: 'utf8', windowsHide: true})
        if (result.status === 0 && result.stdout) {
            const seen = new Set()
            for (const line of result.stdout.trim().split('\n')) {
                const gitExe = line.trim()
                if (!gitExe || seen.has(gitExe)) continue
                seen.add(gitExe)
                // Git for Windows 标准布局: <GitRoot>/cmd/git.exe → ../usr/bin
                const usrBin = resolve(dirname(gitExe), '..', 'usr', 'bin')
                try {
                    if (statSync(usrBin).isDirectory()) dirs.push(usrBin)
                } catch (error) {
                    if (error?.code !== 'ENOENT') log.debug({err: error, path: usrBin}, '检查 Git Bash usr/bin 失败')
                }
                // 也加入 git.exe 自身目录（部分命令如 git 本身在此）
                const binDir = dirname(gitExe)
                try {
                    if (statSync(binDir).isDirectory() && !dirs.includes(binDir)) dirs.push(binDir)
                } catch (error) {
                    if (error?.code !== 'ENOENT') log.debug({err: error, path: binDir}, '检查 Git 可执行目录失败')
                }
            }
        }
    } catch (error) {
        log.debug({err: error}, '动态探测 Git Bash 目录失败')
    }
    // 动态探测失败 → 回退常见路径兜底
    if (dirs.length === 0) {
        const fallbacks = [
            'C:\\Program Files\\Git\\usr\\bin',
            'C:\\Program Files\\Git\\bin',
            'C:\\Program Files (x86)\\Git\\usr\\bin',
            'C:\\Program Files (x86)\\Git\\bin',
            join(homedir(), 'scoop', 'apps', 'git', 'current', 'usr', 'bin'),
        ]
        for (const d of fallbacks) {
            try {
                if (statSync(d).isDirectory()) dirs.push(d)
            } catch (error) {
                if (error?.code !== 'ENOENT') log.debug({err: error, path: d}, '检查 Git Bash 回退目录失败')
            }
        }
    }
    return dirs
}

// ── spawnRtk — 启动 RTK 子进程处理文本压缩 ──
// 功能说明: 拆分 shell 命令为 argv 传参 RTK，由 RTK 执行原生命令并压缩输出
//   用于 Bash 命令输出压缩（减少 token 消耗）和解压（还原原始输出）
// 实现方式: parseShellArgs(cmd) → child_process.spawn(rtkPath, argv) → 监听 stdout/stderr/close
//   exit code 非 0 时 reject 并携带 stderr 前 200 字符用于诊断
// @param {string} rtkPath - RTK 可执行文件绝对路径
// @param {string} cmd - 原始 shell 命令（拆分为 argv 传入 RTK）
// @param {string} _text - 已废弃（RTK 子命令自行执行，不从 stdin 读取）
// @returns {Promise<string>} stdout 输出
function spawnRtk(rtkPath, cmd, _text) {
    return new Promise((resolve, reject) => {
        const parsedArgs = cmd ? parseShellArgs(cmd) : []
        const args = resolveRtkCommandArgs(parsedArgs)
        if (args.length === 0) { resolve(''); return }
        // Windows 上 rtk 子进程需要 Unix 命令 → 动态探测 Git Bash 的 bin 目录合并到 PATH
        const env = {...process.env}
        if (process.platform === 'win32') {
            const gitBashDirs = findGitBashDirs()
            const existing = (env.PATH || '').split(';')
            for (const d of gitBashDirs) {
                try {
                    if (statSync(d).isDirectory() && !existing.includes(d)) existing.push(d)
                } catch (error) {
                    if (error?.code !== 'ENOENT') log.debug({err: error, path: d}, '合并 RTK PATH 失败')
                }
            }
            env.PATH = existing.join(';')
        }
        const child = spawn(rtkPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: RTK_TIMEOUT,
            windowsHide: true,
            env,
        })
        let stdout = ''
        let stderr = ''
        let settled = false
        const finish = (err, result) => {
            if (settled) return
            settled = true
            // 清理 listener，防止 MaxListeners 累积
            child.stdout.removeAllListeners('data')
            child.stderr.removeAllListeners('data')
            child.removeAllListeners('close')
            child.removeAllListeners('error')
            if (err) reject(err); else resolve(result)
        }
        child.stdout.on('data', (d) => { stdout += d.toString() })
        child.stderr.on('data', (d) => { stderr += d.toString() })
        child.once('close', (code) => {
            if (code !== 0 && code !== null) {
                finish(new Error(`rtk exit ${code}: ${stderr.slice(0, 200)}`))
                return
            }
            finish(null, stdout)
        })
        child.once('error', (e) => finish(e))
        // RTK 子命令自己执行原生命令，不需要 stdin 输入
        child.stdin.end()
    })
}


    return {
        CAVEMAN_SKILL_DIR, CAVEMAN_SKILL_FILE, CAVEMAN_VERSION_FILE, CAVEMAN_DEFAULT_CONFIG,
        CAVEMAN_VALID_LEVELS, RTK_TIMEOUT, RTK_REJECT_RATIO, RTK_CRITICAL_PATTERN,
        MAX_RTK_ARCHIVE_BYTES, MAX_REMOTE_TEXT_BYTES, RTK_READONLY_CROSS, RTK_READONLY_UNIX,
        RTK_READONLY_PREFIXES, extractSemver, compareSemver, checkCavemanUpdate,
        downloadAndReplaceCaveman, loadCavemanConfig, saveCavemanConfig, buildCavemanSystemPrompt,
        readFetchBodyLimited, locateRtk, getRtkDir, loadRtkConfig, saveRtkConfig, checkRtkUpdate,
        downloadAndReplaceRtk, rtkPostToolUseHandler, parseShellArgs, isReadOnlyCommand,
        findGitBashDirs, spawnRtk,
    }
}
