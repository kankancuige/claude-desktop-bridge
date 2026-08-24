import {createHash, randomUUID} from 'node:crypto'
import {mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

function failure(message, code, cause = null) {
    return Object.assign(new Error(message), {code, ...(cause ? {cause} : {})})
}

function hash(body) { return createHash('sha256').update(String(body || ''), 'utf8').digest('hex') }
function check(signal) { if (signal?.aborted) throw failure('transcript 恢复已取消', 'TRANSCRIPT_RECOVERY_ABORTED') }

export async function materializeTranscript({repository, projectKey, sessionId, targetPath, expectedHash = null, signal = null} = {}) {
    if (!repository?.get) throw failure('Transcript repository 未配置', 'TRANSCRIPT_REPOSITORY_REQUIRED')
    if (!targetPath) throw failure('Transcript 目标路径未配置', 'TRANSCRIPT_TARGET_INVALID')
    check(signal)
    const row = await repository.get({projectKey, sessionId})
    if (!row || typeof row.body !== 'string') throw failure('Transcript 数据库正文不存在', 'TRANSCRIPT_RECOVERY_NOT_FOUND')
    const actualHash = hash(row.body)
    if (expectedHash && String(expectedHash) !== actualHash) throw failure('Transcript 正文 hash 不匹配', 'TRANSCRIPT_RECOVERY_HASH_MISMATCH')
    check(signal)
    await mkdir(dirname(targetPath), {recursive: true})
    const temporaryPath = join(dirname(targetPath), `.${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.${randomUUID()}.tmp`)
    try {
        await writeFile(temporaryPath, row.body, {encoding: 'utf8', mode: 0o600})
        check(signal)
        await rename(temporaryPath, targetPath)
        return {path: targetPath, hash: actualHash, bytes: Buffer.byteLength(row.body, 'utf8'), version: Number(row.version || 0)}
    } catch (error) {
        await rm(temporaryPath, {force: true}).catch(() => {})
        if (error?.code?.startsWith?.('TRANSCRIPT_')) throw error
        throw failure('Transcript 物化失败', 'TRANSCRIPT_RECOVERY_WRITE_FAILED', error)
    }
}

export async function recoverTranscript({repository, projectKey, sessionId, sdkSessionId = sessionId, targetPath, expectedHash = null, signal = null} = {}) {
    if (!targetPath) throw failure('Transcript 目标路径未配置', 'TRANSCRIPT_TARGET_INVALID')
    check(signal)
    try {
        const current = await stat(targetPath)
        if (current.isFile()) {
            const body = await readFile(targetPath, 'utf8')
            const actualHash = hash(body)
            if (!expectedHash || expectedHash === actualHash) return {status: 'existing', path: targetPath, hash: actualHash, bytes: current.size, source: 'filesystem', sdkSessionId}
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw failure('Transcript 现有文件读取失败', 'TRANSCRIPT_RECOVERY_READ_FAILED', error)
    }
    const materialized = await materializeTranscript({repository, projectKey, sessionId, targetPath, expectedHash, signal})
    return {...materialized, status: 'materialized', source: 'postgres', sdkSessionId}
}
