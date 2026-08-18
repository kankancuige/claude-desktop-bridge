import crypto from 'node:crypto'
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import {join, relative} from 'node:path'

const MAX_FILE_BYTES = 512 * 1024

function projectKey(workDir) {
    const normalized = String(workDir || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
    const drive = normalized.match(/^([a-zA-Z]):\/(.*)$/)
    return drive ? `${drive[1]}--${drive[2].replace(/\//g, '-')}` : normalized.replace(/\//g, '-')
}

function titleOf(filename, content) {
    const heading = String(content || '').match(/^#\s+(.+)$/m)?.[1]?.trim()
    return String(heading || filename.replace(/\.md$/i, '')).slice(0, 500)
}

export function memorySearchTokens(value) {
    const source = String(value || '').toLowerCase()
    const words = source.match(/[a-z0-9][a-z0-9_-]{1,47}|[\p{L}\p{N}_-]{2,48}/gu) || []
    const tokens = words.filter(word => !/\p{Script=Han}/u.test(word))
    for (const run of source.match(/\p{Script=Han}{2,32}/gu) || []) {
        const chars = Array.from(run)
        if (chars.length <= 8) tokens.push(run)
        for (const size of [2, 3, 4]) {
            for (let index = 0; index + size <= chars.length; index++) {
                tokens.push(chars.slice(index, index + size).join(''))
            }
        }
    }
    return [...new Set(tokens)].slice(0, 256)
}

function keywordsOf(filename, content) {
    const source = `${filename}\n${String(content || '').slice(0, 16 * 1024)}`
    return memorySearchTokens(source).join(',')
}

export function memoryProjectKey(workDir) {
    return projectKey(workDir)
}

export function memoryFileMetadata({projectKey: key, sourcePath, filePath, now = Date.now()} = {}) {
    if (!key || !sourcePath || !filePath) throw new TypeError('memory metadata requires projectKey, sourcePath and filePath')
    const stat = statSync(filePath)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw Object.assign(new Error('Memory 文件超过大小限制'), {code: 'MEMORY_FILE_TOO_LARGE'})
    const content = readFileSync(filePath, 'utf8')
    return {
        projectKey: key,
        sourcePath: sourcePath.replace(/\\/g, '/'),
        title: titleOf(sourcePath.split('/').pop() || sourcePath, content),
        keywords: keywordsOf(sourcePath, content),
        contentHash: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
        mtime: stat.mtimeMs,
        size: stat.size,
        status: 'active',
        lastVerifiedAt: now,
    }
}

export function listMemoryFiles({bridgeHome, encodedDir} = {}) {
    if (!bridgeHome || !encodedDir) return []
    const memoryDir = join(bridgeHome, 'projects', encodedDir, 'memory')
    if (!existsSync(memoryDir)) return []
    return readdirSync(memoryDir, {withFileTypes: true})
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .map(entry => ({filename: entry.name, filePath: join(memoryDir, entry.name), sourcePath: relative(join(bridgeHome, 'projects', encodedDir), join(memoryDir, entry.name)).replace(/\\/g, '/') }))
}
