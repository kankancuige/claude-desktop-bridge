const DEFAULTS = Object.freeze({
    idleTimeoutMs: 10 * 60 * 1000,
    toolIdleTimeoutMs: 30 * 60 * 1000,
    maxDurationMs: 2 * 60 * 60 * 1000,
})

function bounded(value, fallback, min, max) {
    const number = Number(value)
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback
}

export function normalizeStreamWatchdogConfig(value = {}) {
    const source = value && typeof value === 'object' ? value : {}
    return {
        idleTimeoutMs: bounded(source.idleTimeoutMs, DEFAULTS.idleTimeoutMs, 30 * 1000, 30 * 60 * 1000),
        toolIdleTimeoutMs: bounded(source.toolIdleTimeoutMs, DEFAULTS.toolIdleTimeoutMs, 60 * 1000, 2 * 60 * 60 * 1000),
        maxDurationMs: bounded(source.maxDurationMs, DEFAULTS.maxDurationMs, 10 * 60 * 1000, 24 * 60 * 60 * 1000),
    }
}

export {DEFAULTS as STREAM_WATCHDOG_DEFAULTS}
