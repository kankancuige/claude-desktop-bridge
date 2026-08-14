import {assertAgentCapabilities, normalizeAgentCapabilities} from '../agents/agent-capabilities.mjs'

function registryError(message, code) {
    return Object.assign(new Error(message), {code})
}

function normalizeName(value, field) {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) {
        throw registryError(`${field} 无效`, 'PROVIDER_REGISTRY_INVALID_NAME')
    }
    return value
}

function providerKey(kind, name) {
    return `${normalizeName(kind, 'Provider kind')}/${normalizeName(name, 'Provider name')}`
}

export function createProviderRegistry({onDisposeError = () => {}} = {}) {
    const entries = new Map()
    let closed = false

    const assertOpen = () => {
        if (closed) throw registryError('Provider Registry 已关闭', 'PROVIDER_REGISTRY_CLOSED')
    }

    const disposeEntry = async entry => {
        if (!entry || entry.disposed) return false
        entry.disposed = true
        entries.delete(entry.key)
        if (typeof entry.provider.dispose === 'function') await entry.provider.dispose()
        return true
    }

    return {
        register(kind, name, provider, capabilities = {}) {
            assertOpen()
            const key = providerKey(kind, name)
            if (!provider || typeof provider.start !== 'function') {
                throw registryError(`Provider ${key} 缺少 start()`, 'PROVIDER_REGISTRY_INVALID_PROVIDER')
            }
            if (entries.has(key)) throw registryError(`Provider ${key} 已注册`, 'PROVIDER_ALREADY_REGISTERED')
            const entry = {
                key,
                kind,
                name,
                provider,
                capabilities: normalizeAgentCapabilities(capabilities),
                disposed: false,
            }
            entries.set(key, entry)
            let disposerCalled = false
            return async () => {
                if (disposerCalled) return false
                disposerCalled = true
                return disposeEntry(entry)
            }
        },

        get(kind, name) {
            const key = providerKey(kind, name)
            const entry = entries.get(key)
            if (!entry || entry.disposed) return null
            return {kind: entry.kind, name: entry.name, capabilities: entry.capabilities}
        },

        require(kind, name, requirements = {}) {
            assertOpen()
            const key = providerKey(kind, name)
            const entry = entries.get(key)
            if (!entry || entry.disposed) throw registryError(`Provider ${key} 未注册`, 'PROVIDER_NOT_FOUND')
            assertAgentCapabilities(entry.capabilities, requirements, {provider: key})
            return {
                kind: entry.kind,
                name: entry.name,
                capabilities: entry.capabilities,
                start(request, nextRequirements = requirements) {
                    assertOpen()
                    assertAgentCapabilities(entry.capabilities, nextRequirements, {provider: key})
                    return entry.provider.start(request, nextRequirements)
                },
            }
        },

        start(kind, name, request, requirements = {}) {
            return this.require(kind, name, requirements).start(request, requirements)
        },

        async disposeAll() {
            if (closed) return
            closed = true
            const failures = []
            for (const entry of [...entries.values()].reverse()) {
                try {
                    await disposeEntry(entry)
                } catch (error) {
                    failures.push(error)
                    onDisposeError(error, {kind: entry.kind, name: entry.name})
                }
            }
            entries.clear()
            if (failures.length) throw new AggregateError(failures, `Provider 释放失败: ${failures.length} 项`)
        },
    }
}
