import {mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'

export function platformEntryFilePath(rootDir, storeName, platform) {
    const safeStore = String(storeName || '')
    const safePlatform = String(platform || '')
    if (!/^[a-z0-9_-]{1,64}$/.test(safeStore) || !/^[a-z0-9_-]{1,32}$/.test(safePlatform)) {
        throw new TypeError('invalid platform entry store name')
    }
    return join(rootDir, `${safeStore}.${safePlatform}.json`)
}

export function clearPlatformEntries(filePath, platform) {
    if (!filePath || !/^[a-z0-9_-]{1,32}$/.test(String(platform || ''))) return 0
    let data
    try {
        data = JSON.parse(readFileSync(filePath, 'utf8'))
    } catch (error) {
        if (error?.code !== 'ENOENT') console.debug('读取平台状态文件失败', error)
        return 0
    }
    const entries = data?.entries && typeof data.entries === 'object' ? data.entries : {}
    const prefix = `${platform}:`
    let deleted = 0
    const kept = {}
    for (const [key, value] of Object.entries(entries)) {
        if (key.startsWith(prefix)) deleted++
        else kept[key] = value
    }
    if (deleted === 0) return 0

    const json = JSON.stringify({...data, entries: kept})
    mkdirSync(dirname(filePath), {recursive: true})
    const tmp = join(dirname(filePath), `.${filePath.split(/[\\/]/).pop()}.tmp`)
    writeFileSync(tmp, json, {encoding: 'utf8', mode: 0o600})
    try {
        renameSync(tmp, filePath)
    } catch (renameError) {
        writeFileSync(filePath, json, {encoding: 'utf8', mode: 0o600})
        try { unlinkSync(tmp) } catch (cleanupError) {
            console.debug('平台状态临时文件清理失败', {renameError, cleanupError, tmp})
        }
    }
    return deleted
}
