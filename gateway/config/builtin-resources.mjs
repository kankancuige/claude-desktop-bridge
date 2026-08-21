import {createHash} from 'node:crypto'
import {cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync} from 'node:fs'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
export const BUILTIN_RESOURCE_ROOT = resolve(MODULE_DIR, '..', 'builtin-resources')
const MANIFEST_PATH = join(BUILTIN_RESOURCE_ROOT, 'manifest.json')
const STATE_FILE_NAME = 'builtin-resource-state.json'
const RESOURCE_TYPES = new Set(['skill', 'rule', 'agent', 'hook', 'command', 'workflow', 'mcp'])
const SAFE_ID = /^[a-zA-Z0-9._:-]{1,128}$/
const stateCache = new Map()
const STATE_CACHE_TTL_MS = 1000

function atomicWriteJson(filePath, value) {
    mkdirSync(dirname(filePath), {recursive: true})
    const temporaryPath = `${filePath}.${process.pid}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, filePath)
}

function readJson(filePath, fallback) {
    try {
        const value = JSON.parse(readFileSync(filePath, 'utf8'))
        return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
    } catch {
        return fallback
    }
}

function validateRelativePath(value, label) {
    if (typeof value !== 'string' || !value || isAbsolute(value)) throw new Error(`${label} 必须是相对路径`)
    const normalized = value.replace(/\\/g, '/')
    if (normalized.split('/').includes('..') || normalized.startsWith('/')) throw new Error(`${label} 包含非法路径`)
    return normalized
}

function normalizeManifest(manifest) {
    if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.resources)) {
        throw new Error('Bridge 内置资源 manifest 格式无效')
    }
    const seen = new Set()
    const resources = manifest.resources.map((raw) => {
        if (!raw || typeof raw !== 'object') throw new Error('Bridge 内置资源条目格式无效')
        const id = String(raw.id || '').trim()
        const type = String(raw.type || '').trim()
        if (!SAFE_ID.test(id) || !RESOURCE_TYPES.has(type)) throw new Error(`Bridge 内置资源条目无效：${type}/${id}`)
        const key = `${type}:${id}`
        if (seen.has(key)) throw new Error(`Bridge 内置资源重复：${key}`)
        seen.add(key)
        return Object.freeze({
            id,
            type,
            source: validateRelativePath(raw.source, `${key}.source`),
            target: validateRelativePath(raw.target || raw.source, `${key}.target`),
            version: String(raw.version || '1'),
            defaultEnabled: raw.defaultEnabled !== false,
            required: raw.required === true,
            description: typeof raw.description === 'string' ? raw.description : '',
        })
    })
    return Object.freeze({schemaVersion: Number(manifest.schemaVersion || 1), resources: Object.freeze(resources)})
}

export function loadBuiltinResourceManifest() {
    return normalizeManifest(readJson(MANIFEST_PATH, null))
}

function resourceKey(resource) {
    return `${resource.type}:${resource.id}`
}

function resolveResourcePath(root, resourcePath) {
    const base = resolve(root)
    const target = resolve(base, resourcePath)
    const prefix = `${base}${sep}`
    if (target !== base && !target.startsWith(prefix)) throw new Error('Bridge 内置资源路径越界')
    return target
}

function walkFiles(root, current = root, result = []) {
    if (!existsSync(current)) return result
    const info = statSync(current)
    if (info.isFile()) {
        result.push(current)
        return result
    }
    for (const entry of readdirSync(current).sort()) walkFiles(root, join(current, entry), result)
    return result
}

function checksumPath(filePath, root = dirname(filePath)) {
    if (!existsSync(filePath)) return null
    const hash = createHash('sha256')
    for (const child of walkFiles(filePath).sort()) {
        const rel = relative(root, child).replace(/\\/g, '/')
        hash.update(rel)
        hash.update('\0')
        hash.update(readFileSync(child))
        hash.update('\0')
    }
    return hash.digest('hex')
}

function metadataPath(filePath, root = dirname(filePath)) {
    if (!existsSync(filePath)) return null
    return walkFiles(filePath).sort().map(child => {
        const info = statSync(child)
        return `${relative(root, child).replace(/\\/g, '/')}|${info.size}|${Math.trunc(info.mtimeMs)}`
    }).join('\n')
}

function copyResource(source, target) {
    mkdirSync(dirname(target), {recursive: true})
    cpSync(source, target, {recursive: true, dereference: true, force: false, errorOnExist: false, preserveTimestamps: true})
}

function loadResourceState(bridgeHome) {
    return readJson(join(bridgeHome, STATE_FILE_NAME), {schemaVersion: 1, resources: {}})
}

function loadDisabledResources(bridgeHome) {
    const settings = readJson(join(bridgeHome, 'settings.json'), {})
    const raw = settings.disabledBuiltinResources
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return Object.fromEntries(Object.entries(raw).map(([type, ids]) => [type, Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []]))
}

function saveDisabledResources(bridgeHome, disabled) {
    const settingsPath = join(bridgeHome, 'settings.json')
    const settings = readJson(settingsPath, {})
    settings.disabledBuiltinResources = disabled
    atomicWriteJson(settingsPath, settings)
}

function isDisabled(disabled, resource) {
    return Array.isArray(disabled[resource.type]) && disabled[resource.type].includes(resource.id)
}

export function ensureBuiltinResources({bridgeHome} = {}) {
    if (typeof bridgeHome !== 'string' || !bridgeHome.trim() || !isAbsolute(bridgeHome)) throw new Error('Bridge 私有目录必须是绝对路径')
    const targetRoot = resolve(bridgeHome)
    mkdirSync(targetRoot, {recursive: true})
    const manifest = loadBuiltinResourceManifest()
    const state = loadResourceState(targetRoot)
    const nextState = {...state, schemaVersion: 1, resources: {...(state.resources || {})}}
    const result = {installed: [], updated: [], customized: [], skipped: []}

    for (const resource of manifest.resources) {
        const source = resolveResourcePath(BUILTIN_RESOURCE_ROOT, resource.source)
        const target = resolveResourcePath(targetRoot, resource.target)
        if (!existsSync(source)) throw new Error(`Bridge 内置资源源文件不存在：${resourceKey(resource)}`)
        const previous = nextState.resources[resourceKey(resource)] || {}
        const sourceMetadata = metadataPath(source, BUILTIN_RESOURCE_ROOT)
        const sourceChecksum = previous.sourceMetadata === sourceMetadata && previous.sourceChecksum
            ? previous.sourceChecksum
            : checksumPath(source, BUILTIN_RESOURCE_ROOT)
        const targetMetadata = metadataPath(target, targetRoot)
        const targetChecksum = targetMetadata && previous.targetMetadata === targetMetadata && previous.targetChecksum
            ? previous.targetChecksum
            : checksumPath(target, targetRoot)
        let customized = false
        if (!targetChecksum) {
            copyResource(source, target)
            result.installed.push(resourceKey(resource))
        } else if (targetChecksum === sourceChecksum) {
            result.skipped.push(resourceKey(resource))
        } else if (previous.sourceChecksum && targetChecksum === previous.sourceChecksum) {
            copyResource(source, target)
            result.updated.push(resourceKey(resource))
        } else {
            customized = true
            result.customized.push(resourceKey(resource))
        }
        const effectiveTargetMetadata = metadataPath(target, targetRoot)
        nextState.resources[resourceKey(resource)] = {
            version: resource.version,
            sourceChecksum,
            sourceMetadata,
            targetMetadata: effectiveTargetMetadata,
            targetChecksum: customized ? targetChecksum : sourceChecksum,
            customized,
            updatedAt: new Date().toISOString(),
        }
    }
    atomicWriteJson(join(targetRoot, STATE_FILE_NAME), nextState)
    stateCache.delete(targetRoot)
    return result
}

/**
 * 将早期的 Skill/MCP 开关迁移到内置资源的唯一状态源。
 * 仅移动 manifest 中已声明的内置项，用户自定义项仍保留在旧数组中以兼容旧客户端。
 */
export function migrateLegacyBuiltinResourceState({bridgeHome} = {}) {
    const targetRoot = resolve(bridgeHome)
    const settingsPath = join(targetRoot, 'settings.json')
    const settings = readJson(settingsPath, {})
    const manifest = loadBuiltinResourceManifest()
    const disabled = loadDisabledResources(targetRoot)
    const mappings = [
        {legacyKey: 'disabledSkills', type: 'skill'},
        {legacyKey: 'disabledMcpPlugins', type: 'mcp'},
    ]
    const migrated = []
    let changed = false

    for (const {legacyKey, type} of mappings) {
        const builtinIds = new Set(manifest.resources.filter(item => item.type === type).map(item => item.id))
        const legacyIds = Array.isArray(settings[legacyKey])
            ? settings[legacyKey].filter(id => typeof id === 'string')
            : []
        const builtinDisabled = legacyIds.filter(id => builtinIds.has(id))
        if (builtinDisabled.length === 0) continue

        const nextDisabled = new Set(Array.isArray(disabled[type]) ? disabled[type] : [])
        for (const id of builtinDisabled) {
            nextDisabled.add(id)
            migrated.push(`${type}:${id}`)
        }
        disabled[type] = [...nextDisabled].sort()
        settings[legacyKey] = legacyIds.filter(id => !builtinIds.has(id))
        changed = true
    }

    if (changed) {
        settings.disabledBuiltinResources = disabled
        atomicWriteJson(settingsPath, settings)
        stateCache.delete(targetRoot)
    }
    return {migrated, changed}
}

export function getBuiltinResourceState({bridgeHome} = {}) {
    const targetRoot = resolve(bridgeHome)
    const cached = stateCache.get(targetRoot)
    if (cached && Date.now() - cached.at < STATE_CACHE_TTL_MS) return cached.value
    const manifest = loadBuiltinResourceManifest()
    const state = loadResourceState(targetRoot)
    const disabled = loadDisabledResources(targetRoot)
    const value = manifest.resources.map(resource => {
        const item = state.resources?.[resourceKey(resource)] || {}
        const installedPath = resolveResourcePath(targetRoot, resource.target)
        const installed = existsSync(installedPath)
        const currentMetadata = installed ? metadataPath(installedPath, targetRoot) : null
        const currentChecksum = installed && item.targetMetadata === currentMetadata && item.targetChecksum
            ? item.targetChecksum
            : installed ? checksumPath(installedPath, targetRoot) : null
        const customized = item.customized === true || (installed && item.sourceChecksum && currentChecksum !== item.sourceChecksum)
        return {
            ...resource,
            source: 'builtin',
            enabled: resource.required ? true : !isDisabled(disabled, resource),
            installed,
            customized,
            checksum: currentChecksum,
        }
    })
    stateCache.set(targetRoot, {at: Date.now(), value})
    return value
}

export function setBuiltinResourceEnabled({bridgeHome, type, id, enabled} = {}) {
    const targetRoot = resolve(bridgeHome)
    const resource = loadBuiltinResourceManifest().resources.find(item => item.type === type && item.id === id)
    if (!resource) {
        const error = new Error(`未知的 Bridge 内置资源：${type}/${id}`)
        error.code = 'BUILTIN_RESOURCE_NOT_FOUND'
        throw error
    }
    if (resource.required && enabled === false) {
        const error = new Error(`必需的 Bridge 内置资源不能关闭：${type}/${id}`)
        error.code = 'BUILTIN_RESOURCE_REQUIRED'
        throw error
    }
    const disabled = loadDisabledResources(targetRoot)
    const ids = new Set(Array.isArray(disabled[type]) ? disabled[type] : [])
    if (enabled === false) ids.add(id)
    else ids.delete(id)
    disabled[type] = [...ids].sort()
    saveDisabledResources(targetRoot, disabled)
    stateCache.delete(targetRoot)
    return getBuiltinResourceState({bridgeHome: targetRoot}).find(item => item.type === type && item.id === id)
}

export function isBuiltinResourceEnabled({bridgeHome, type, id} = {}) {
    return Boolean(getBuiltinResourceState({bridgeHome}).find(item => item.type === type && item.id === id)?.enabled)
}

export function builtinResourceKey(type, id) {
    return resourceKey({type, id})
}
