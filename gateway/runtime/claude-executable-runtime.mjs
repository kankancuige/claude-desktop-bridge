/** Claude Code 可执行文件解析。 */
export function createClaudeExecutableRuntime({
    homedir,
    join,
    dirname,
    existsSync,
    readdirSync,
    statSync,
    execSync,
    loadCliSettings,
    env = process.env,
    platform = process.platform,
    logger = {debug() {}},
} = {}) {
    let cached = null
    function resolveFromPkgDir(pkgDir) {
        if (!existsSync(pkgDir)) return null
        for (const relative of ['bin/claude.exe', 'cli.js']) {
            const path = join(pkgDir, relative)
            if (existsSync(path)) return path
        }
        return null
    }
    function getClaudeExe() {
        if (cached) {
            if (existsSync(cached)) return cached
            cached = null
        }
        if (env.CLAUDE_EXE) return (cached = env.CLAUDE_EXE)
        const configured = loadCliSettings()?.claudeExe
        if (configured && existsSync(configured)) return (cached = configured)
        const candidates = []
        const addVersioned = (base, executable) => {
            if (!existsSync(base)) return
            try {
                for (const version of readdirSync(base).filter(item => statSync(join(base, item)).isDirectory()).sort().reverse()) {
                    const path = join(base, version, executable)
                    if (existsSync(path)) candidates.push(path)
                }
            } catch (error) { logger.debug({err: error, path: base}, '扫描 Claude 版本目录失败') }
        }
        addVersioned(join(homedir(), 'AppData', 'Local', 'Claude-3p', 'claude-code'), 'claude.exe')
        addVersioned(join(homedir(), 'Library', 'Application Support', 'Claude-3p', 'claude-code'), 'claude')
        addVersioned(join(homedir(), '.local', 'share', 'Claude-3p', 'claude-code'), 'claude')
        candidates.push(
            join(homedir(), '.local', 'bin', platform === 'win32' ? 'claude.exe' : 'claude'),
            join(homedir(), 'AppData', 'Local', 'Programs', 'claude-code', 'claude.exe'),
            '/opt/homebrew/bin/claude', '/usr/local/bin/claude',
            join(homedir(), 'Library', 'Application Support', 'Claude', 'claude'),
            join(homedir(), '.local', 'bin', 'claude'), '/usr/bin/claude',
        )
        for (const path of candidates) if (existsSync(path)) return (cached = path)
        try {
            const command = platform === 'win32' ? 'where claude' : 'which claude'
            const raw = execSync(command, {encoding: 'utf8', timeout: 3000}).trim().split('\n')[0].trim()
            if (raw && existsSync(raw)) {
                if (/\.(exe|js|mjs)$/i.test(raw)) return (cached = raw)
                const resolved = resolveFromPkgDir(join(dirname(raw), 'node_modules', '@anthropic-ai', 'claude-code'))
                if (resolved) return (cached = resolved)
            }
        } catch (error) { logger.debug({err: error}, 'PATH 中查找 Claude 失败') }
        try {
            const root = execSync('npm root -g', {encoding: 'utf8', timeout: 5000}).trim()
            const resolved = root && resolveFromPkgDir(join(root, '@anthropic-ai', 'claude-code'))
            if (resolved) return (cached = resolved)
        } catch (error) { logger.debug({err: error}, 'npm 全局目录查找 Claude 失败') }
        const nvmHomes = [env.NVM_HOME, env.NVM_DIR, join(homedir(), 'AppData', 'Roaming', 'nvm'), join(homedir(), '.nvm'), join(homedir(), '.nvm', 'versions', 'node'), join(homedir(), 'AppData', 'Local', 'fnm'), join(homedir(), 'AppData', 'Local', 'fnm-node-versions'), join(homedir(), '.local', 'share', 'fnm'), join(homedir(), '.volta', 'tools', 'image', 'node')].filter(Boolean)
        for (const root of nvmHomes) {
            if (!existsSync(root)) continue
            try {
                for (const version of readdirSync(root).filter(item => /^v\d/.test(item) && statSync(join(root, item)).isDirectory()).sort().reverse()) {
                    for (const subdir of ['node_modules', 'lib/node_modules']) {
                        const resolved = resolveFromPkgDir(join(root, version, subdir, '@anthropic-ai', 'claude-code'))
                        if (resolved) return (cached = resolved)
                    }
                }
            } catch (error) { logger.debug({err: error, path: root}, '扫描 Node 版本目录失败') }
        }
        const globalRoots = [join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules'), env.NVM_SYMLINK ? join(env.NVM_SYMLINK, 'node_modules') : null, env.APPDATA ? join(env.APPDATA, 'npm', 'node_modules') : null, env.ProgramFiles ? join(env.ProgramFiles, 'nodejs', 'node_modules') : null, env.PREFIX ? join(env.PREFIX, 'node_modules') : null].filter(Boolean)
        for (const root of globalRoots) {
            const resolved = resolveFromPkgDir(join(root, '@anthropic-ai', 'claude-code'))
            if (resolved) return (cached = resolved)
        }
        return (cached = null)
    }
    function setClaudeExe(value) {
        cached = typeof value === 'string' && value.trim() ? value.trim() : null
        return cached
    }
    return {resolveFromPkgDir, getClaudeExe, setClaudeExe}
}
