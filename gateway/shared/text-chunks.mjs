export function splitTextByUtf8Bytes(text, maxBytes, reserveBytes = 16) {
    const source = String(text || '')
    if (!source) return []
    const limit = Math.max(64, maxBytes - reserveBytes)
    const out = []
    let current = ''
    let bytes = 0
    for (const ch of source) {
        const size = Buffer.byteLength(ch, 'utf8')
        if (current && bytes + size > limit) {
            out.push(current)
            current = ''
            bytes = 0
        }
        current += ch
        bytes += size
    }
    if (current) out.push(current)
    return out
}
