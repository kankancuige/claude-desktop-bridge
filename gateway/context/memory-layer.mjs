import {createHash} from 'node:crypto'

const MAX_L0_CHARS = 240
const MAX_L1_CHARS = 1600
const SECRET_ASSIGNMENT = /((?:api[_ -]?key|auth(?:orization)?[_ -]?token|access[_ -]?token|token|password|passwd|secret)\s*["']?\s*[:=：]\s*["']?)([^"'\s,;，；}\]]+)/gi
const BEARER_TOKEN = /(authorization\s*["']?\s*[:=：]\s*["']?\s*bearer\s+)([^"'\s,;，；}\]]+)/gi
const PREFIXED_TOKEN = /\b(?:sk|xox[baprs]|gh[opurs])-[A-Za-z0-9_-]{8,}\b/gi

function boundedText(value, max) {
    return String(value || '').replace(/[\0\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function redact(value) {
    return String(value || '')
        .replace(SECRET_ASSIGNMENT, '$1[已脱敏]')
        .replace(BEARER_TOKEN, '$1[已脱敏]')
        .replace(PREFIXED_TOKEN, '[token 已脱敏]')
}

function bodyText(body) {
    return redact(String(body || '')
        .replace(/^```[\s\S]*?```/gm, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/^[>*-]\s+/gm, '')
        .replace(/\[[^\]]*\]\([^)]*\)/g, '$1'))
}

function firstSentence(value, max) {
    const clean = boundedText(value, max)
    const boundary = clean.search(/[。！？!?；;.]/)
    return clean.slice(0, boundary >= 0 ? Math.min(boundary + 1, max) : max)
}

function hash(value) {
    return createHash('sha256').update(String(value || ''), 'utf8').digest('hex')
}

export function deriveMemoryLayers(body = '') {
    const clean = bodyText(body)
    const l0 = firstSentence(clean, MAX_L0_CHARS)
    const l1 = boundedText(clean, MAX_L1_CHARS)
    return {l0, l1}
}

export function normalizeMemoryMetadata(metadata = {}, body = '') {
    const source = metadata && typeof metadata === 'object' ? metadata : {}
    const derived = deriveMemoryLayers(body)
    const normalized = {
        ...source,
        schemaVersion: 1,
        memoryType: boundedText(source.memoryType || 'fact', 48) || 'fact',
        parentKey: boundedText(source.parentKey || '', 240) || null,
        l0: boundedText(source.l0 || derived.l0, MAX_L0_CHARS),
        l1: boundedText(source.l1 || derived.l1, MAX_L1_CHARS),
        summaryBodyHash: source.summaryBodyHash || hash(body),
        summaryGenerator: boundedText(source.summaryGenerator || 'deterministic-v1', 80),
    }
    return normalized
}

export function memoryTier(row = {}, requestedTier = 'auto') {
    const requested = String(requestedTier || 'auto').toLowerCase()
    if (['l0', 'l1', 'l2'].includes(requested)) return requested
    const metadata = row?.metadata || {}
    if (metadata.l1) return 'l1'
    if (metadata.l0) return 'l0'
    return 'l2'
}

export function selectMemoryContent(row = {}, requestedTier = 'auto') {
    const tier = memoryTier(row, requestedTier)
    const metadata = row?.metadata || {}
    const content = tier === 'l0' ? metadata.l0 : tier === 'l1' ? metadata.l1 : row.body || ''
    return {tier, content: String(content || '')}
}

export const MEMORY_LAYER_LIMITS = Object.freeze({l0Chars: MAX_L0_CHARS, l1Chars: MAX_L1_CHARS})
