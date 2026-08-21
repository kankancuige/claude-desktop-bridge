import {cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {isAbsolute, join, normalize, resolve} from 'node:path'
import {ensureBuiltinResources, migrateLegacyBuiltinResourceState} from './builtin-resources.mjs'

const MIGRATION_VERSION = 1
const MIGRATION_MARKER = `.bridge-migration-v${MIGRATION_VERSION}.json`

const MIGRATED_DIRECTORIES = Object.freeze([
    'agents',
    'channels',
    'commands',
    'file-history',
    'hooks',
    'paste-cache',
    'plans',
    'plugins',
    'projects',
    'rules',
    'session-env',
    'sessions',
    'shell-snapshots',
    'skills',
    'tasks',
    'todos',
    'workflow-journals',
    'workflows',
    'worktrees',
])

const MIGRATED_FILES = Object.freeze(new Set([
    'adapter-sessions.json',
    'adapters.json',
    'bridge-deleted-sessions.json',
    'bridge-dynamic-cache.json',
    'bridge-preferences.json',
    'bridge-provider.json',
    'bridge-scheduled-tasks.json',
    'bridge-store-key',
    'bridge-workflow-history.jsonl',
    'bridge-workflow.json',
    'settings.json',
]))

const MIGRATED_FILE_PREFIXES = Object.freeze([
    'bridge-im-inbox',
    'bridge-notification-outbox',
    'bridge-paired',
])

const PROVIDER_ENV_KEYS = new Set([
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL',
    'CLAUDE_CODE_OAUTH_TOKEN',
])

export function resolveBridgeHome({env = process.env, homeDir = homedir()} = {}) {
    const configured = typeof env.BRIDGE_HOME === 'string' ? env.BRIDGE_HOME.trim() : ''
    if (configured && !isAbsolute(configured)) {
        const error = new Error('BRIDGE_HOME 必须是绝对路径')
        error.code = 'BRIDGE_HOME_NOT_ABSOLUTE'
        throw error
    }
    return normalize(resolve(configured || join(homeDir, '.claude-desktop-bridge')))
}

export const BRIDGE_HOME = resolveBridgeHome()

export function bridgePath(...segments) {
    return join(BRIDGE_HOME, ...segments)
}

export function configureClaudeRuntime(bridgeHome = BRIDGE_HOME) {
    if (!isAbsolute(bridgeHome)) {
        const error = new Error('Claude Runtime 配置目录必须是绝对路径')
        error.code = 'BRIDGE_HOME_NOT_ABSOLUTE'
        throw error
    }
    process.env.CLAUDE_CONFIG_DIR = normalize(resolve(bridgeHome))
    return process.env.CLAUDE_CONFIG_DIR
}

function atomicWriteJson(filePath, value) {
    const temporaryPath = `${filePath}.${process.pid}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, filePath)
}

function replaceLegacyPath(value, legacyHome, bridgeHome) {
    if (typeof value === 'string') {
        const replacements = [
            [legacyHome, bridgeHome],
            [legacyHome.replace(/\\/g, '/'), bridgeHome.replace(/\\/g, '/')],
            ['${HOME}/.claude', bridgeHome.replace(/\\/g, '/')],
            ['$HOME/.claude', bridgeHome.replace(/\\/g, '/')],
            ['~/.claude', bridgeHome.replace(/\\/g, '/')],
            ['%USERPROFILE%\\.claude', bridgeHome],
        ]
        return replacements.reduce((current, [from, to]) => current.split(from).join(to), value)
    }
    if (Array.isArray(value)) return value.map(item => replaceLegacyPath(item, legacyHome, bridgeHome))
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceLegacyPath(item, legacyHome, bridgeHome)]))
}

function migrateSettings(sourcePath, targetPath, legacyHome, bridgeHome) {
    const source = JSON.parse(readFileSync(sourcePath, 'utf8'))
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error('旧 settings.json 内容不是对象')
    }
    const migrated = replaceLegacyPath(source, legacyHome, bridgeHome)
    delete migrated.model
    if (migrated.env && typeof migrated.env === 'object' && !Array.isArray(migrated.env)) {
        for (const key of PROVIDER_ENV_KEYS) delete migrated.env[key]
        if (Object.keys(migrated.env).length === 0) delete migrated.env
    }
    atomicWriteJson(targetPath, migrated)
}

function shouldMigrateTopLevelFile(name) {
    return MIGRATED_FILES.has(name) || MIGRATED_FILE_PREFIXES.some(prefix => name.startsWith(prefix))
}

function copyMissing(sourcePath, targetPath) {
    const sourceStat = lstatSync(sourcePath)
    if (sourceStat.isDirectory()) {
        mkdirSync(targetPath, {recursive: true})
        let copied = false
        for (const entry of readdirSync(sourcePath)) {
            if (copyMissing(join(sourcePath, entry), join(targetPath, entry)) === 'copied') copied = true
        }
        return copied ? 'copied' : 'skipped'
    }
    if (existsSync(targetPath)) return 'skipped'
    cpSync(sourcePath, targetPath, {
        recursive: true,
        dereference: true,
        force: false,
        errorOnExist: false,
        preserveTimestamps: true,
    })
    return 'copied'
}

export function prepareBridgeHome({
    bridgeHome = BRIDGE_HOME,
    legacyHome = join(homedir(), '.claude'),
    now = () => new Date().toISOString(),
} = {}) {
    const targetRoot = normalize(resolve(bridgeHome))
    const sourceRoot = normalize(resolve(legacyHome))
    if (!isAbsolute(targetRoot) || !isAbsolute(sourceRoot)) {
        const error = new Error('Bridge 配置迁移路径必须是绝对路径')
        error.code = 'BRIDGE_HOME_NOT_ABSOLUTE'
        throw error
    }
    if (targetRoot.toLowerCase() === sourceRoot.toLowerCase()) {
        const error = new Error('Bridge 私有目录不能与 Claude 配置目录相同')
        error.code = 'BRIDGE_HOME_NOT_ISOLATED'
        throw error
    }

    mkdirSync(targetRoot, {recursive: true})
    // 内置资源先补齐到 Bridge 私有目录；只复制缺失或未被用户修改的版本。
    const builtinResources = ensureBuiltinResources({bridgeHome: targetRoot})
    const markerPath = join(targetRoot, MIGRATION_MARKER)
    let previous = null
    try {
        previous = JSON.parse(readFileSync(markerPath, 'utf8'))
    } catch {
        previous = null
    }
    if (previous?.completed === true && previous?.version === MIGRATION_VERSION) {
        const resourceStateMigration = migrateLegacyBuiltinResourceState({bridgeHome: targetRoot})
        configureClaudeRuntime(targetRoot)
        return {...previous, markerPath, alreadyComplete: true, builtinResources, resourceStateMigration}
    }

    const result = {
        version: MIGRATION_VERSION,
        source: sourceRoot,
        target: targetRoot,
        attemptedAt: now(),
        completed: false,
        copied: [],
        skipped: [],
        failures: [],
    }

    if (existsSync(sourceRoot)) {
        const entries = new Map(readdirSync(sourceRoot, {withFileTypes: true}).map(entry => [entry.name, entry]))
        const candidates = [
            ...MIGRATED_DIRECTORIES.filter(name => entries.get(name)?.isDirectory()),
            ...[...entries.values()].filter(entry => entry.isFile() && shouldMigrateTopLevelFile(entry.name)).map(entry => entry.name),
        ]
        for (const name of [...new Set(candidates)].sort()) {
            const sourcePath = join(sourceRoot, name)
            const targetPath = join(targetRoot, name)
            try {
                const status = name === 'settings.json' && !existsSync(targetPath)
                    ? (migrateSettings(sourcePath, targetPath, sourceRoot, targetRoot), 'copied')
                    : copyMissing(sourcePath, targetPath)
                result[status].push(name)
            } catch (error) {
                result.failures.push({name, code: error?.code || 'MIGRATION_COPY_FAILED', message: String(error?.message || error)})
            }
        }
    }

    const resourceStateMigration = migrateLegacyBuiltinResourceState({bridgeHome: targetRoot})
    result.completed = result.failures.length === 0
    atomicWriteJson(markerPath, result)
    configureClaudeRuntime(targetRoot)
    if (!result.completed) {
        const error = new Error(`Bridge 配置迁移失败：${result.failures.map(item => item.name).join(', ')}`)
        error.code = 'BRIDGE_HOME_MIGRATION_FAILED'
        error.failures = result.failures
        throw error
    }
    return {...result, markerPath, alreadyComplete: false, builtinResources, resourceStateMigration}
}
