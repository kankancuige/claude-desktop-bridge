import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs'
import {basename, dirname, extname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {BRIDGE_HOME} from '../config/bridge-home.mjs'
import {detectProjectStack} from './project-cache.mjs'

const VERSION = 2
const MAX_DEPTH = 3
const MAX_FILES = 160
const MAX_MANIFEST_BYTES = 512 * 1024
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'dist-electron', 'build', 'out', '.next', '.cache', '.idea', '.vscode', 'coverage', '.venv', 'venv', '__pycache__'])
const LOCKFILES = new Map([
    ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['package-lock.json', 'npm'],
    ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['Cargo.lock', 'cargo'],
])
const EXACT_MANIFESTS = new Set([
    'package.json', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'bun.lock', 'bun.lockb',
    'pom.xml', 'build.gradle', 'build.gradle.kts', 'Cargo.toml', 'Cargo.lock', 'go.mod',
    'pyproject.toml', 'AGENTS.md', 'CLAUDE.md', 'tsconfig.json',
])

function normalizedWorkDir(workDir) {
    if (typeof workDir !== 'string' || !workDir.trim() || !isAbsolute(workDir)) return null
    return resolve(workDir)
}

function projectKey(workDir) {
    const normalized = resolve(workDir).replace(/\\/g, '/').toLowerCase()
    return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 24)
}

function contextPath(workDir, bridgeHome = BRIDGE_HOME) {
    return join(bridgeHome, 'projects', `context-${projectKey(workDir)}`, 'project-context.json')
}

function isAllowedFile(name) {
    return EXACT_MANIFESTS.has(name)
        || /\.(?:csproj|sln)$/i.test(name)
        || /^build\.gradle(?:\.kts)?$/i.test(name)
}

function scanAllowedFiles(workDir, {maxDepth = MAX_DEPTH, maxFiles = MAX_FILES} = {}) {
    const files = []
    const walk = (dir, depth) => {
        if (depth > maxDepth || files.length >= maxFiles) return
        let entries = []
        try {
            entries = readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name, 'en'))
        } catch {
            return
        }
        for (const entry of entries) {
            if (files.length >= maxFiles) break
            if (entry.isDirectory()) {
                if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.git')) walk(join(dir, entry.name), depth + 1)
                continue
            }
            if (!entry.isFile() || !isAllowedFile(entry.name)) continue
            const absolute = join(dir, entry.name)
            try {
                if (statSync(absolute).size <= MAX_MANIFEST_BYTES) files.push(absolute)
            } catch {
                // 文件可能在扫描期间被删除，忽略该条目即可。
            }
        }
    }
    walk(workDir, 0)
    return files
}

function readAllowed(filePath) {
    try {
        return readFileSync(filePath, 'utf8')
    } catch {
        return ''
    }
}

function manifestFingerprint(files, workDir, {includeHash = true} = {}) {
    return files.map(filePath => {
        const relPath = relative(workDir, filePath).replace(/\\/g, '/')
        try {
            const stat = statSync(filePath)
            return {path: relPath, size: stat.size, mtimeMs: stat.mtimeMs, sha256: includeHash ? createHash('sha256').update(readFileSync(filePath)).digest('hex') : null}
        } catch {
            return {path: relPath, size: -1, mtimeMs: 0, sha256: null}
        }
    }).sort((a, b) => a.path.localeCompare(b.path, 'en'))
}

function pushUnique(target, value) {
    if (value && !target.includes(value)) target.push(value)
}

function command(name, executable, args, source, kind = null) {
    const normalizedKind = kind || (/^test(?::|$)/i.test(name) ? 'test' : /^build(?::|$)/i.test(name) ? 'build' : 'static')
    return {name, kind: normalizedKind, executable, args, source}
}

function packageManagerExecutable(packageManager) {
    const value = packageManager || 'npm'
    return process.platform === 'win32' && ['npm', 'pnpm', 'yarn'].includes(value)
        ? `${value}.cmd`
        : value
}

function parsePackageJson(content, relPath, context) {
    let pkg
    try {
        pkg = JSON.parse(content)
    } catch {
        return
    }
    pushUnique(context.languages, pkg.devDependencies?.typescript || pkg.dependencies?.typescript ? 'TypeScript' : 'JavaScript')
    const deps = {...(pkg.dependencies || {}), ...(pkg.devDependencies || {})}
    for (const [dependency, framework] of [['vue', 'Vue'], ['react', 'React'], ['electron', 'Electron'], ['next', 'Next.js'], ['@angular/core', 'Angular'], ['svelte', 'Svelte']]) {
        if (deps[dependency]) pushUnique(context.frameworks, framework)
    }
    for (const [name, script] of Object.entries(pkg.scripts || {}).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
        if (!/^(?:build|test|check|lint|typecheck|verify)(?::|$)/i.test(name) || typeof script !== 'string') continue
        context.commands.push(command(name, packageManagerExecutable(context.packageManager), ['run', name], relPath))
    }
}

function parseManifest(filePath, workDir, context) {
    const name = basename(filePath)
    const relPath = relative(workDir, filePath).replace(/\\/g, '/')
    const content = readAllowed(filePath)
    if (LOCKFILES.has(name)) context.packageManager = context.packageManager || LOCKFILES.get(name)
    if (name === 'package.json') parsePackageJson(content, relPath, context)
    if (name === 'pom.xml') {
        pushUnique(context.languages, 'Java')
        if (/<artifactId>spring-boot/i.test(content)) pushUnique(context.frameworks, 'Spring Boot')
        context.commands.push(command('test', 'mvn', ['test'], relPath, 'test'))
    }
    if (/^build\.gradle/.test(name)) {
        pushUnique(context.languages, content.includes('kotlin') ? 'Kotlin' : 'Java')
        if (/org\.springframework\.boot/.test(content)) pushUnique(context.frameworks, 'Spring Boot')
        context.commands.push(command('test', process.platform === 'win32' ? 'gradlew.bat' : './gradlew', ['test'], relPath, 'test'))
    }
    if (/\.csproj$/i.test(name)) {
        pushUnique(context.languages, 'C#')
        if (/<UseWPF>true/i.test(content)) pushUnique(context.frameworks, 'WPF')
        if (/<UseWindowsForms>true/i.test(content)) pushUnique(context.frameworks, 'WinForms')
        const packageReferences = [...content.matchAll(/<PackageReference\b[^>]*\bInclude\s*=\s*["']([^"']+)["']/gi)].map(match => match[1])
        if (packageReferences.some(value => /^Avalonia(?:\.|$)/i.test(value)) || /<UseAvalonia>true/i.test(content)) pushUnique(context.frameworks, 'Avalonia')
        context.commands.push(command('build', 'dotnet', ['build', relPath], relPath))
        context.commands.push(command('test', 'dotnet', ['test', relPath, '--no-build'], relPath, 'test'))
    }
    if (/\.sln$/i.test(name)) {
        context.commands.push(command('build', 'dotnet', ['build', relPath], relPath))
        context.commands.push(command('test', 'dotnet', ['test', relPath, '--no-build'], relPath, 'test'))
    }
    if (name === 'Cargo.toml') {
        pushUnique(context.languages, 'Rust')
        context.packageManager ||= 'cargo'
        context.commands.push(command('test', 'cargo', ['test'], relPath))
    }
    if (name === 'go.mod') {
        pushUnique(context.languages, 'Go')
        context.packageManager ||= 'go'
        context.commands.push(command('test', 'go', ['test', './...'], relPath))
    }
    if (name === 'pyproject.toml') {
        pushUnique(context.languages, 'Python')
        context.packageManager ||= /\[tool\.poetry\]/.test(content) ? 'poetry' : /\[tool\.uv\]/.test(content) ? 'uv' : 'python'
    }
    if (name === 'AGENTS.md' || name === 'CLAUDE.md') context.rules.push({path: relPath, kind: name === 'AGENTS.md' ? 'agents' : 'claude'})
    if (/[/\\](?:\.agents|\.claude)[/\\]skills[/\\][^/\\]+[/\\]SKILL\.md$/i.test(filePath)) {
        context.skills.push({name: basename(dirname(filePath)), path: relPath})
    }
}

function normalizeContext(context) {
    if (context.languages.includes('TypeScript')) {
        context.languages = context.languages.filter(language => language !== 'JavaScript')
    }
    if (context.frameworks.includes('Vue 3')) {
        context.frameworks = context.frameworks.filter(framework => framework !== 'Vue')
    }
    const byCommand = new Map()
    for (const item of context.commands) {
        const key = `${item.executable}\0${item.args.join('\0')}`
        if (!byCommand.has(key)) byCommand.set(key, item)
    }
    return {
        ...context,
        languages: context.languages.sort(),
        frameworks: context.frameworks.sort(),
        commands: [...byCommand.values()].slice(0, 40),
        rules: context.rules.sort((a, b) => a.path.localeCompare(b.path, 'en')).slice(0, 40),
        skills: context.skills.sort((a, b) => a.path.localeCompare(b.path, 'en')).slice(0, 80),
    }
}

function readGitSummary(workDir) {
    const headPath = join(workDir, '.git', 'HEAD')
    const head = readAllowed(headPath).trim()
    if (!head) return {available: false, branch: null, detached: false}
    const match = head.match(/^ref:\s+refs\/heads\/(.+)$/)
    return {available: true, branch: match?.[1] || null, detached: !match}
}

export async function buildProjectContext(workDir, options = {}) {
    const root = normalizedWorkDir(workDir)
    if (!root || !existsSync(root)) return null
    const stack = detectProjectStack(root)
    const context = {
        version: VERSION,
        workDir: root,
        projectKey: projectKey(root),
        languages: [],
        frameworks: [],
        packageManager: null,
        commands: [],
        rules: [],
        skills: [],
        manifestFingerprint: [],
        git: readGitSummary(root),
        generatedAt: Number(options.now?.() ?? Date.now()),
        source: 'bounded-manifest-scan',
    }
    const files = scanAllowedFiles(root, options)
    context.manifestFingerprint = manifestFingerprint(files, root)
    // 先确定 package manager，再解析 package.json 中的受信命令，避免目录排序改变命令运行器。
    for (const filePath of files.filter(filePath => LOCKFILES.has(basename(filePath)))) parseManifest(filePath, root, context)
    for (const filePath of files.filter(filePath => !LOCKFILES.has(basename(filePath)))) parseManifest(filePath, root, context)
    if (stack.language && stack.language !== 'Unknown') pushUnique(context.languages, stack.language)
    if (stack.framework) for (const part of stack.framework.split('+').map(value => value.trim())) pushUnique(context.frameworks, part)
    context.packageManager ||= stack.packageManager || null
    const normalized = normalizeContext(context)
    if (options.persist !== false) saveProjectContext(root, normalized, options)
    return normalized
}

export function loadProjectContext(workDir, options = {}) {
    const root = normalizedWorkDir(workDir)
    if (!root) return null
    try {
        const value = JSON.parse(readFileSync(contextPath(root, options.bridgeHome), 'utf8'))
        if (value?.version !== VERSION || value?.workDir !== root || !Array.isArray(value.manifestFingerprint)) return null
        const current = manifestFingerprint(scanAllowedFiles(root, options), root)
        return JSON.stringify(current) === JSON.stringify(value.manifestFingerprint) ? value : null
    } catch {
        return null
    }
}

export async function loadOrBuildProjectContext(workDir, options = {}) {
    return loadProjectContext(workDir, options) || buildProjectContext(workDir, options)
}

export function saveProjectContext(workDir, context, options = {}) {
    const root = normalizedWorkDir(workDir)
    if (!root || !context) return false
    const filePath = contextPath(root, options.bridgeHome)
    mkdirSync(dirname(filePath), {recursive: true})
    writeFileSync(filePath, `${JSON.stringify(context, null, 2)}\n`, 'utf8')
    return true
}

export function projectContextCachePath(workDir, options = {}) {
    const root = normalizedWorkDir(workDir)
    return root ? contextPath(root, options.bridgeHome) : null
}
