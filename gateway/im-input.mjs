export const MAX_IM_TEXT_BYTES = 64 * 1024

export function validateImText(text, {maxBytes = MAX_IM_TEXT_BYTES} = {}) {
    if (typeof text !== 'string' || !text.trim()) return {ok: false, code: 'invalid_input', bytes: 0}
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > maxBytes) return {ok: false, code: 'message_too_large', bytes}
    return {ok: true, bytes}
}
