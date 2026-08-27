export const AGENT_PERMISSION_MODES = Object.freeze(['default', 'acceptEdits', 'plan', 'bypassPermissions'])

export function normalizePermissionMode(value, fallback = 'default') {
    const candidate = String(value || '').trim()
    return AGENT_PERMISSION_MODES.includes(candidate) ? candidate : fallback
}

export function resolveEffectivePermissionMode({parentPermissionMode, agentPermissionMode, fallback = 'acceptEdits'} = {}) {
    return normalizePermissionMode(parentPermissionMode || agentPermissionMode, fallback)
}

export function canDelegateWriteToParent({permissionMode, agentWritable = false} = {}) {
    return !agentWritable || normalizePermissionMode(permissionMode) === 'plan'
}
