import {join} from 'node:path'

export const MIRROR_PLATFORMS = Object.freeze(['wechat', 'feishu', 'dingtalk'])

export function defaultMirrors() {
    return {wechat: false, feishu: false, dingtalk: false}
}

export function normalizeMirrors(value) {
    const source = value && typeof value === 'object' ? value : {}
    return Object.fromEntries(MIRROR_PLATFORMS.map(platform => [platform, source[platform] === true]))
}

export function mirrorStorePath(projectDir) {
    if (typeof projectDir !== 'string' || !projectDir) throw new TypeError('projectDir 无效')
    return join(projectDir, 'bridge-session-mirrors.json')
}

export function normalizeMirrorStore(value) {
    const source = value && typeof value === 'object' ? value : {}
    const sessions = source.sessions && typeof source.sessions === 'object' ? source.sessions : {}
    const normalized = {}
    for (const [id, entry] of Object.entries(sessions)) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) continue
        normalized[id] = {
            mirrors: normalizeMirrors(entry?.mirrors),
            ids: mirrorSessionIds(entry?.ids, id),
            updatedAt: Number.isFinite(Number(entry?.updatedAt)) ? Number(entry.updatedAt) : 0,
        }
    }
    return {version: 1, sessions: normalized}
}

export function mirrorSessionIds(...ids) {
    return [...new Set(ids.flat().filter(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)))]
}

export function getPersistedMirrors(store, ids) {
    const normalized = normalizeMirrorStore(store)
    for (const id of mirrorSessionIds(ids)) {
        const entry = normalized.sessions[id]
        if (entry) return {...entry.mirrors}
    }
    return defaultMirrors()
}

export function setPersistedMirror(store, ids, platform, enabled, updatedAt = Date.now()) {
    if (!MIRROR_PLATFORMS.includes(platform)) throw new TypeError('platform 无效')
    const next = normalizeMirrorStore(store)
    const aliases = mirrorSessionIds(ids)
    const mirrors = getPersistedMirrors(next, aliases)
    mirrors[platform] = enabled === true
    const entry = {mirrors, ids: aliases, updatedAt: Number.isFinite(Number(updatedAt)) ? Number(updatedAt) : Date.now()}
    for (const id of aliases) next.sessions[id] = {mirrors: {...mirrors}, ids: [...aliases], updatedAt: entry.updatedAt}
    return next
}

export function setPersistedMirrors(store, ids, mirrors, updatedAt = Date.now()) {
    let next = normalizeMirrorStore(store)
    for (const platform of MIRROR_PLATFORMS) {
        next = setPersistedMirror(next, ids, platform, mirrors?.[platform] === true, updatedAt)
    }
    return next
}

export function removePersistedMirrors(store, ids) {
    const next = normalizeMirrorStore(store)
    const targets = new Set(mirrorSessionIds(ids))
    for (const [id, entry] of Object.entries(next.sessions)) {
        if (targets.has(id) || entry.ids.some(alias => targets.has(alias))) delete next.sessions[id]
    }
    return next
}
