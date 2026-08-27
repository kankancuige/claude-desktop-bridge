import {mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'

const PAIRED_USER_FILE_NAMES = Object.freeze({
    wechat: 'bridge-paired.json',
    feishu: 'bridge-paired-feishu.json',
    dingtalk: 'bridge-paired-dingtalk.json',
})

function normalizeUsers(users, maxUsers = 10_000) {
    const result = []
    for (const value of users || []) {
        if (typeof value !== 'string' || !value || value.length > 512 || /[\0\r\n]/.test(value)) continue
        if (!result.includes(value)) result.push(value)
        if (result.length >= maxUsers) break
    }
    return result
}

export function loadPairedUsers(filePath) {
    try {
        const data = JSON.parse(readFileSync(filePath, 'utf8'))
        return new Set(normalizeUsers(data?.users))
    } catch (error) {
        if (error?.code !== 'ENOENT') console.debug('读取 IM 配对白名单失败', error)
        return new Set()
    }
}

export function loadPairedUserCount(bridgeHome, platform) {
    const fileName = PAIRED_USER_FILE_NAMES[platform]
    if (!fileName || !bridgeHome) return 0
    return loadPairedUsers(join(bridgeHome, fileName)).size
}

export function savePairedUsers(filePath, users) {
    const normalized = normalizeUsers(users)
    const json = JSON.stringify({users: normalized})
    mkdirSync(dirname(filePath), {recursive: true})
    const tmp = join(dirname(filePath), `.${filePath.split(/[\\/]/).pop()}.tmp`)
    writeFileSync(tmp, json, {encoding: 'utf8', mode: 0o600})
    try {
        renameSync(tmp, filePath)
    } catch (renameError) {
        writeFileSync(filePath, json, {encoding: 'utf8', mode: 0o600})
        try { unlinkSync(tmp) } catch (cleanupError) {
            console.debug('IM 配对白名单临时文件清理失败', {renameError, cleanupError})
        }
    }
    return normalized.length
}
