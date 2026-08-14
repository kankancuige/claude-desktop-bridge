import {existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, unlinkSync} from 'node:fs'
import {safeChildPath} from '../security/path-security.mjs'

export function cleanupUploadDir(uploadDir, {
    removeAll = false,
    ttlMs,
    preserveDirectory = false,
    onError = () => {},
} = {}) {
    if (!uploadDir || !existsSync(uploadDir)) return {removed: 0, bytes: 0}
    const now = Date.now()
    let removed = 0
    let bytes = 0
    for (const name of readdirSync(uploadDir)) {
        const filePath = safeChildPath(uploadDir, name, {allowNested: false})
        if (!filePath) continue
        try {
            const st = lstatSync(filePath)
            if (!st.isFile()) continue
            if (!removeAll && now - st.mtimeMs < ttlMs) continue
            bytes += st.size
            unlinkSync(filePath)
            removed++
        } catch (error) {
            // 文件可能被并发请求清理，仅忽略已不存在的附件。
            if (error?.code !== 'ENOENT') onError(error, filePath)
        }
    }
    if (!preserveDirectory) {
        try {
            if (readdirSync(uploadDir).length === 0) rmdirSync(uploadDir)
        } catch (error) {
            if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') onError(error, uploadDir)
        }
    }
    return {removed, bytes}
}

export function prepareUploadDir(uploadDir, options = {}) {
    mkdirSync(uploadDir, {recursive: true})
    return cleanupUploadDir(uploadDir, {...options, preserveDirectory: true})
}
