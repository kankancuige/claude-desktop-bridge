import {existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {safeBasename, safeChildPath} from '../security/path-security.mjs'

export const MAX_MEMORY_FILE_BYTES = 512 * 1024

function memoryError(message, code, statusCode = 400) {
    return Object.assign(new Error(message), {code, statusCode})
}

function resolveMemoryPath(bridgeHome, encodedDir, filename = null) {
    const projectsRoot = join(bridgeHome, 'projects')
    const projectDir = safeBasename(projectsRoot, String(encodedDir || ''))
    const memoryDir = projectDir ? safeChildPath(projectDir, 'memory', {allowNested: false}) : null
    const filePath = filename === null ? null : (memoryDir
        ? safeBasename(memoryDir, String(filename || ''), {extensions: ['.md']})
        : null)
    if (!projectDir || !memoryDir || (filename !== null && !filePath)) {
        throw memoryError('Memory 路径无效', 'MEMORY_PATH_INVALID')
    }
    return {projectDir, memoryDir, filePath}
}

function sourcePath(filename) {
    return `memory/${filename}`
}

export function listProjectMemory({bridgeHome, encodedDir, workDir, memoryService, query = ''} = {}) {
    const {memoryDir} = resolveMemoryPath(bridgeHome, encodedDir)
    memoryService?.refreshProject?.({workDir, encodedDir})
    const metadata = new Map((memoryService?.list?.({encodedDir, status: null, limit: 500}) || [])
        .map(item => [item.sourcePath, item]))
    const needle = String(query || '').trim().toLowerCase()
    const files = []
    if (!existsSync(memoryDir)) return {files, mode: memoryService?.stateStore ? 'sqlite' : 'file'}
    const filenames = readdirSync(memoryDir, {withFileTypes: true})
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .map(entry => entry.name)
    for (const filename of filenames) {
        const {filePath} = resolveMemoryPath(bridgeHome, encodedDir, filename)
        if (!filePath || !existsSync(filePath)) continue
        const stat = statSync(filePath)
        if (!stat.isFile() || stat.size > MAX_MEMORY_FILE_BYTES) continue
        const content = readFileSync(filePath, 'utf8')
        const item = metadata.get(sourcePath(filename)) || {}
        if (needle && !`${filename}\n${content}\n${item.title || ''}\n${item.keywords || ''}`.toLowerCase().includes(needle)) continue
        files.push({
            filename,
            content,
            size: Buffer.byteLength(content, 'utf8'),
            sourcePath: sourcePath(filename),
            title: item.title || filename.replace(/\.md$/i, ''),
            scope: item.scope || 'project',
            confidence: Number(item.confidence ?? 1),
            status: item.status || 'active',
            lastVerifiedAt: item.lastVerifiedAt || null,
            lastUsedAt: item.lastUsedAt || null,
        })
    }
    return {files, mode: memoryService?.stateStore ? 'sqlite' : 'file'}
}

export function saveProjectMemory({bridgeHome, encodedDir, workDir, filename, content, memoryService} = {}) {
    const {memoryDir, filePath} = resolveMemoryPath(bridgeHome, encodedDir, filename)
    if (typeof content !== 'string') throw memoryError('Memory 内容必须是字符串', 'MEMORY_CONTENT_INVALID')
    const size = Buffer.byteLength(content, 'utf8')
    if (size > MAX_MEMORY_FILE_BYTES) throw memoryError('Memory 文件超过 512 KB 限制', 'MEMORY_FILE_TOO_LARGE', 413)
    mkdirSync(memoryDir, {recursive: true})
    writeFileSync(filePath, content, {encoding: 'utf8', mode: 0o600})
    memoryService?.refreshProject?.({workDir, encodedDir})
    return {filename, size}
}

export function deleteProjectMemory({bridgeHome, encodedDir, filename, memoryService} = {}) {
    const {filePath} = resolveMemoryPath(bridgeHome, encodedDir, filename)
    if (!existsSync(filePath)) throw memoryError('Memory 文件不存在', 'MEMORY_NOT_FOUND', 404)
    unlinkSync(filePath)
    memoryService?.remove?.({encodedDir, sourcePath: sourcePath(filename)})
    return {filename}
}

export function setProjectMemoryEnabled({encodedDir, filename, enabled, memoryService} = {}) {
    if (!memoryService?.stateStore) throw memoryError('Memory 索引不可用', 'MEMORY_INDEX_UNAVAILABLE', 503)
    const changed = memoryService.setEnabled({encodedDir, sourcePath: sourcePath(filename), enabled: enabled !== false})
    if (!changed) throw memoryError('Memory 索引记录不存在', 'MEMORY_NOT_FOUND', 404)
    return {filename, status: enabled === false ? 'disabled' : 'active'}
}

export function rebuildProjectMemory({workDir, encodedDir, memoryService} = {}) {
    if (!memoryService?.stateStore) throw memoryError('Memory 索引不可用', 'MEMORY_INDEX_UNAVAILABLE', 503)
    return memoryService.rebuild({workDir, encodedDir})
}
