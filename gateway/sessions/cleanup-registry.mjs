const CLEANUP_ORDER = Object.freeze({query: 10, stream: 20, timer: 30, watchdog: 40, listener: 50, other: 60})

function normalizeKind(value) {
    const kind = String(value || 'other').trim().toLowerCase()
    return Object.hasOwn(CLEANUP_ORDER, kind) ? kind : 'other'
}

function normalizeRegistration(args) {
    if (typeof args[0] === 'function') return {kind: normalizeKind(args[1]?.kind), cleanup: args[0], label: args[1]?.label}
    return {kind: normalizeKind(args[0]), cleanup: args[1], label: args[2]}
}

/**
 * 统一父级取消下的资源清理顺序。Registry 不拥有资源，只负责按契约调用注册的清理函数。
 */
export function createCleanupRegistry({parentSignal = null} = {}) {
    const controller = new AbortController()
    const entries = []
    let state = 'active'
    let abortPromise = null

    const detachParent = () => {
        if (parentSignal && typeof parentSignal.removeEventListener === 'function') {
            parentSignal.removeEventListener('abort', onParentAbort)
        }
    }

    const onParentAbort = () => { void abort(parentSignal.reason || 'parent_aborted') }
    if (parentSignal?.aborted) onParentAbort()
    else parentSignal?.addEventListener?.('abort', onParentAbort, {once: true})

    function register(...args) {
        const item = normalizeRegistration(args)
        if (typeof item.cleanup !== 'function') throw new TypeError('Cleanup Registry 需要 cleanup 函数')
        let active = true
        const entry = {
            kind: item.kind,
            label: String(item.label || item.kind),
            status: state === 'active' ? 'registered' : 'disposed',
            error: null,
            cleanup: item.cleanup,
        }
        entries.push(entry)
        const unregister = async () => {
            if (!active) return {status: entry.status, error: entry.error}
            active = false
            if (entry.status === 'registered') await runEntry(entry, 'manual')
            return {status: entry.status, error: entry.error}
        }
        if (state !== 'active') void unregister()
        return unregister
    }

    async function runEntry(entry, reason) {
        if (entry.status !== 'registered') return
        entry.status = 'running'
        try {
            await entry.cleanup(reason)
            entry.status = 'cleaned'
        } catch (error) {
            entry.error = error instanceof Error ? error.message : String(error)
            entry.status = 'failed'
        }
    }

    function abort(reason = 'aborted') {
        if (abortPromise) return abortPromise
        state = 'aborting'
        if (!controller.signal.aborted) controller.abort(reason)
        abortPromise = (async () => {
            const ordered = entries
                .filter(entry => entry.status === 'registered')
                .sort((a, b) => CLEANUP_ORDER[a.kind] - CLEANUP_ORDER[b.kind])
            for (const entry of ordered) await runEntry(entry, reason)
            state = 'aborted'
            detachParent()
            return snapshot()
        })()
        return abortPromise
    }

    async function dispose(reason = 'disposed') {
        if (state === 'active') await abort(reason)
        else if (abortPromise) await abortPromise
        state = 'disposed'
        detachParent()
        return snapshot()
    }

    function snapshot() {
        return {
            state,
            aborted: controller.signal.aborted,
            reason: controller.signal.reason ?? null,
            entries: entries.map(({kind, label, status, error}) => ({kind, label, status, error})),
        }
    }

    return Object.freeze({signal: controller.signal, register, abort, dispose, snapshot})
}

export {CLEANUP_ORDER}
