function normalizeExternalUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || /[\0\r\n]/.test(value)) return null
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null
    return parsed.toString()
  } catch {
    return null
  }
}

module.exports = {normalizeExternalUrl}
