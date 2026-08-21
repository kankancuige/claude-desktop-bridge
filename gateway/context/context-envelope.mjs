import {createHash} from 'node:crypto'

const FINGERPRINT_VERSION = 1
const DIGEST_PREFIX = 'sha256:'

function stableStringify(value) {
    if (value === null || value === undefined) return 'null'
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
    if (typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
    }
    return JSON.stringify(value)
}

function digest(value, length = 16) {
    return `${DIGEST_PREFIX}${createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, length)}`
}

function normalizeText(value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 256) : fallback
}

function normalizeRoute(value) {
    if (!Array.isArray(value)) return []
    return value.map(item => {
        if (typeof item === 'string') return {name: item.slice(0, 128)}
        if (!item || typeof item !== 'object') return {name: ''}
        return {
            name: normalizeText(item.name || item.id || item.type),
            version: normalizeText(item.version),
            enabled: item.enabled !== false,
        }
    }).sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)))
}

function normalizeRevision(value) {
    return normalizeText(value, 'unknown')
}

/**
 * 返回不含 Prompt、凭据或原始路径的稳定上下文投影。
 * Provider identity 仅用于本地哈希分区，绝不作为事件正文输出。
 */
export function buildContextEnvelope(input = {}) {
    const providerKey = digest(normalizeText(input.providerIdentity, 'unknown-provider'))
    const stableDimensions = {
        permission: normalizeText(input.permissionMode, 'unknown'),
        thinking: normalizeText(input.thinkingLevel, 'unknown'),
        profile: normalizeText(input.contextProfile, 'full'),
        skills: digest(normalizeRoute(input.skillRoute)),
        agents: digest(normalizeRoute(input.agentRoute)),
        toolset: normalizeRevision(input.toolsetRevision),
        rules: normalizeRevision(input.ruleRevision),
        projectContext: normalizeRevision(input.projectContextRevision),
    }
    const model = normalizeText(input.model, 'unknown-model')
    const protocolFamily = normalizeText(input.protocolFamily, 'unknown-protocol')
    const resumeAvailable = Boolean(normalizeText(input.resumeSessionId))
    return {
        version: FINGERPRINT_VERSION,
        providerKey,
        model,
        protocolFamily,
        resumeMode: resumeAvailable ? 'available' : 'unavailable',
        resumeAvailable,
        fingerprint: digest({version: FINGERPRINT_VERSION, providerKey, model, protocolFamily, stableDimensions}),
        stableDimensions,
    }
}

function changed(left, right) {
    return left !== right
}

export function compareContextEnvelopes(previous, next) {
    if (!previous || !next) {
        return {changedDimensions: ['envelope_unavailable'], sameCachePartition: false}
    }
    const dimensions = []
    if (changed(previous.providerKey, next.providerKey)) dimensions.push('provider')
    if (changed(previous.model, next.model)) dimensions.push('model')
    if (changed(previous.protocolFamily, next.protocolFamily)) dimensions.push('protocol')
    const labels = {
        permission: 'permission', thinking: 'thinking', profile: 'context_profile',
        skills: 'skills', agents: 'agents', toolset: 'tools', rules: 'rules', projectContext: 'project_context',
    }
    for (const [key, label] of Object.entries(labels)) {
        if (changed(previous.stableDimensions?.[key], next.stableDimensions?.[key])) dimensions.push(label)
    }
    return {
        changedDimensions: dimensions,
        sameCachePartition: previous.providerKey === next.providerKey
            && previous.model === next.model
            && previous.protocolFamily === next.protocolFamily
            && previous.fingerprint === next.fingerprint,
    }
}
