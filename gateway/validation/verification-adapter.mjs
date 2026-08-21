const ADAPTER_TYPES = new Set(['command', 'build', 'test', 'runtime', 'browser', 'websocket', 'database', 'device'])

export function normalizeVerificationAdapter(adapter = {}) {
    const id = String(adapter.id || '').trim()
    const type = String(adapter.type || '').trim()
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(id) || !ADAPTER_TYPES.has(type)) throw new TypeError('VerificationAdapter id/type 无效')
    if (typeof adapter.execute !== 'function') throw new TypeError('VerificationAdapter 缺少 execute')
    return Object.freeze({
        id,
        type,
        prepare: typeof adapter.prepare === 'function' ? adapter.prepare : async () => ({}),
        execute: adapter.execute,
        collectEvidence: typeof adapter.collectEvidence === 'function' ? adapter.collectEvidence : async result => result,
        cleanup: typeof adapter.cleanup === 'function' ? adapter.cleanup : async () => {},
        evaluate: typeof adapter.evaluate === 'function' ? adapter.evaluate : result => result?.passed === true,
        timeoutMs: Math.max(100, Math.min(60 * 60 * 1000, Number(adapter.timeoutMs) || 60_000)),
    })
}

export function createVerificationAdapterRegistry(initial = []) {
    const adapters = new Map()
    return {
        registerVerificationAdapter(adapter) {
            const normalized = normalizeVerificationAdapter(adapter)
            adapters.set(normalized.id, normalized)
            return normalized
        },
        get(id) {
            return adapters.get(String(id || '')) || null
        },
        list() {
            return [...adapters.values()]
        },
        initialize() {
            for (const adapter of initial) this.registerVerificationAdapter(adapter)
            return this
        },
    }.initialize()
}

export function registerVerificationAdapter(adapter) {
    return normalizeVerificationAdapter(adapter)
}
