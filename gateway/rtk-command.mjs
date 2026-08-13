export function resolveRtkCommandArgs(args, {platform = process.platform, execPath = process.execPath, electronRunAsNode = process.env.ELECTRON_RUN_AS_NODE} = {}) {
    if (!Array.isArray(args) || args.length === 0) return []
    const resolved = [...args]
    if (platform === 'win32'
        && electronRunAsNode === '1'
        && typeof execPath === 'string'
        && execPath
        && /^node(?:\.exe)?$/i.test(String(resolved[0] || ''))) {
        resolved[0] = execPath
    }
    return resolved
}
