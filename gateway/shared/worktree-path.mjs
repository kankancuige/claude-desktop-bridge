export function sanitizeWorktreeSegment(value, fallback = 'workflow') {
    if (!/[a-zA-Z0-9]/.test(String(value || ''))) return fallback
    const segment = String(value || '')
        .replace(/[\\/]+/g, '_')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/^\.+$/, '')
        .slice(0, 96)
    return segment || fallback
}
