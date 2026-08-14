export function createImTurnTimeout({
    onTimeout,
    idleMs = 10 * 60 * 1000,
    maxMs = 45 * 60 * 1000,
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
} = {}) {
    if (typeof onTimeout !== 'function') throw new TypeError('onTimeout is required')
    const startedAt = now()
    let stopped = false
    let timer = null

    const schedule = () => {
        if (stopped) return
        if (timer) clearTimer(timer)
        const remaining = Math.max(0, maxMs - (now() - startedAt))
        timer = setTimer(() => {
            if (stopped) return
            stopped = true
            onTimeout()
        }, Math.min(idleMs, remaining))
        timer?.unref?.()
    }

    schedule()
    return {
        touch: () => schedule(),
        stop: () => {
            stopped = true
            if (timer) clearTimer(timer)
            timer = null
        },
    }
}
