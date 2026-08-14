import {existsSync, realpathSync} from 'node:fs'
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path'

function isWithin(root, candidate) {
    const rel = relative(root, candidate)
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function realPathWithin(root, candidate) {
    let rootProbe = root
    while (!existsSync(rootProbe)) {
        const parent = dirname(rootProbe)
        if (parent === rootProbe) return false
        rootProbe = parent
    }
    const realRoot = realpathSync(rootProbe)
    let probe = candidate
    while (!existsSync(probe)) {
        const parent = dirname(probe)
        if (parent === probe) return false
        probe = parent
    }
    return isWithin(realRoot, realpathSync(probe))
}

export function safeChildPath(root, input, {allowNested = true, extensions = null} = {}) {
    if (typeof root !== 'string' || typeof input !== 'string' || !input || input.includes('\0')) return null
    const normalized = input.replace(/\\/g, '/')
    // 先拒绝编码后的分隔符/点，避免调用方 decode 顺序不同造成路径穿越。
    if (/%(?:2f|5c|2e)/i.test(normalized)) return null
    if (normalized.startsWith('/') || normalized.startsWith('//') || /^[a-zA-Z]:/.test(normalized)) return null
    const segments = normalized.split('/')
    if (!allowNested && segments.length !== 1) return null
    if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null
    if (extensions && !extensions.some(ext => normalized.toLowerCase().endsWith(ext.toLowerCase()))) return null
    const rootAbs = resolve(root)
    const candidate = resolve(rootAbs, normalized)
    if (!isWithin(rootAbs, candidate) || !realPathWithin(rootAbs, candidate)) return null
    return candidate
}

export function safeBasename(root, input, options = {}) {
    return safeChildPath(root, input, {...options, allowNested: false})
}
