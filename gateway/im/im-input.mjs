export const MAX_IM_TEXT_BYTES = 64 * 1024

export function normalizeImMessageId(value, {maxLength = 200} = {}) {
    if (!Number.isInteger(maxLength) || maxLength < 1) throw new TypeError('maxLength must be a positive integer')
    if (value === undefined || value === null || value === '') return ''
    if (typeof value === 'number' && !Number.isFinite(value)) return ''
    if (!['string', 'number', 'bigint'].includes(typeof value)) return ''
    return String(value).trim().slice(0, maxLength)
}

export function validateImText(text, {maxBytes = MAX_IM_TEXT_BYTES} = {}) {
    if (typeof text !== 'string' || !text.trim()) return {ok: false, code: 'invalid_input', bytes: 0}
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > maxBytes) return {ok: false, code: 'message_too_large', bytes}
    return {ok: true, bytes}
}
