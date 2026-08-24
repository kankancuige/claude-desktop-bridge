import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import {join, relative} from 'node:path'
import {contentHash} from './postgres-content-store.mjs'

const MAX_MEMORY_BYTES = 512 * 1024
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024

function projectKeyFromDirectory(name) {
    return String(name || '').trim()
}

function shouldRead(filePath, maxBytes) {
    try {
        const stat = statSync(filePath)
        return stat.isFile() && stat.size <= maxBytes
    } catch {
        return false
    }
}

function memoryFiles(projectDir) {
    const memoryDir = join(projectDir, 'memory')
    if (!existsSync(memoryDir)) return []
    return readdirSync(memoryDir, {withFileTypes: true})
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .map(entry => join(memoryDir, entry.name))
}

function transcriptFiles(projectDir) {
    if (!existsSync(projectDir)) return []
    return readdirSync(projectDir, {withFileTypes: true})
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl') && !entry.name.startsWith('.trash-'))
        .map(entry => join(projectDir, entry.name))
}

export async function migrateContentFiles({bridgeHome, gateway, projectKeys = null, includeTranscripts = true, dryRun = false, signal = null, maxProjects = 500, maxTranscripts = 5000} = {}) {
    if (!bridgeHome || !gateway?.content?.put) throw new TypeError('bridgeHome and StorageGateway.content are required')
    const projectsRoot = join(bridgeHome, 'projects')
    const directories = existsSync(projectsRoot)
        ? readdirSync(projectsRoot, {withFileTypes: true}).filter(entry => entry.isDirectory()).slice(0, Math.max(1, Math.min(5000, Number(maxProjects) || 500))).map(entry => ({key: projectKeyFromDirectory(entry.name), path: join(projectsRoot, entry.name)}))
        : []
    const selected = projectKeys ? new Set((Array.isArray(projectKeys) ? projectKeys : [projectKeys]).map(projectKeyFromDirectory)) : null
    const result = {projects: 0, memories: 0, transcripts: 0, bytes: 0, skipped: 0, failed: 0, dryRun: Boolean(dryRun)}
    for (const project of directories) {
        if (selected && !selected.has(project.key)) continue
        if (signal?.aborted) throw Object.assign(new Error('内容迁移已取消'), {code: 'CONTENT_MIGRATION_ABORTED'})
        result.projects++
        for (const filePath of memoryFiles(project.path)) {
            if (signal?.aborted) throw Object.assign(new Error('内容迁移已取消'), {code: 'CONTENT_MIGRATION_ABORTED'})
            if (!shouldRead(filePath, MAX_MEMORY_BYTES)) { result.skipped++; continue }
            const sourceKey = `memory/${filePath.slice(filePath.lastIndexOf('\\') + 1).replace(/\\/g, '/')}`
            const body = readFileSync(filePath, 'utf8')
            result.bytes += Buffer.byteLength(body, 'utf8')
            if (!dryRun) await gateway.content.put({projectKey: project.key, kind: 'memory', sourceKey, title: sourceKey.slice(7, -3), body, bodyHash: contentHash(body)})
            result.memories++
        }
        if (!includeTranscripts) continue
        for (const filePath of transcriptFiles(project.path).slice(0, Math.max(1, Math.min(10000, Number(maxTranscripts) || 5000)))) {
            if (signal?.aborted) throw Object.assign(new Error('内容迁移已取消'), {code: 'CONTENT_MIGRATION_ABORTED'})
            if (!shouldRead(filePath, MAX_TRANSCRIPT_BYTES)) { result.skipped++; continue }
            const body = readFileSync(filePath, 'utf8')
            const sourceKey = `session/${filePath.slice(filePath.lastIndexOf('\\') + 1).replace(/\\/g, '/').replace(/\.jsonl$/i, '')}`
            result.bytes += Buffer.byteLength(body, 'utf8')
            if (!dryRun) await gateway.content.put({projectKey: project.key, kind: 'transcript', sourceKey, title: sourceKey.slice(8), body, bodyHash: contentHash(body), metadata: {format: 'jsonl', transcriptPath: filePath}})
            result.transcripts++
        }
    }
    return result
}
