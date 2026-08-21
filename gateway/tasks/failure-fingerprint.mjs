import {createHash} from 'node:crypto'

export function normalizeFailureMessage(value) {
    return String(value || '')
        .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
        .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)\S+/gi, '$1[REDACTED]')
        .replace(/[A-Za-z]:[\\/][^\s:'"]+/g, '<path>')
        .replace(/\b\d+\b/g, '#')
        .replace(/\s+/g, ' ').trim().slice(0, 1000)
}

export function createFailureFingerprint(input = {}) {
    const normalized = [input.projectKey, input.module, input.phase, input.errorCode, input.testLocation, normalizeFailureMessage(input.message)].map(value => String(value || '')).join('|')
    return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 24)
}
