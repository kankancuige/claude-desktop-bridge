export const AGENT_CAPABILITY_NAMES = Object.freeze([
    'writable',
    'resumable',
    'modelOverride',
    'structuredOutput',
    'toolFiltering',
    'continuation',
])

function capabilityError(message, capability = null, provider = null) {
    return Object.assign(new Error(message), {
        code: 'AGENT_CAPABILITY_UNSUPPORTED',
        capability,
        provider,
    })
}

export function normalizeAgentCapabilities(input = {}) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    return Object.freeze(Object.fromEntries(AGENT_CAPABILITY_NAMES.map(name => [name, source[name] === true])))
}

export function normalizeAgentRequirements(input = {}) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    return Object.freeze(Object.fromEntries(AGENT_CAPABILITY_NAMES.map(name => [name, source[name] === true])))
}

export function assertAgentCapabilities(capabilities, requirements = {}, {provider = 'unknown'} = {}) {
    const normalized = normalizeAgentCapabilities(capabilities)
    const required = normalizeAgentRequirements(requirements)
    for (const name of AGENT_CAPABILITY_NAMES) {
        if (required[name] && !normalized[name]) {
            throw capabilityError(`Agent Provider ${provider} 不支持必需能力 ${name}`, name, provider)
        }
    }
    return normalized
}

export function requirementsForAgentStart({
    options = {},
    writable = null,
    structuredOutput = false,
    toolFiltering = false,
    continuation = true,
} = {}) {
    return normalizeAgentRequirements({
        writable: writable === null ? options.permissionMode !== 'plan' : writable,
        resumable: Boolean(options.resume),
        modelOverride: Boolean(options.model),
        structuredOutput,
        toolFiltering: toolFiltering || Boolean(options.allowedTools || options.disallowedTools),
        continuation,
    })
}
