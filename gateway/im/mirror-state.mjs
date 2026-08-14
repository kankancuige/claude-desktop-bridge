/**
 * 为单次 IM 回合缓存 mirror 查询。WebSocket connected 帧可覆盖仍在进行的 HTTP 预读取结果。
 */
export function createMirrorStateResolver(loadState) {
    if (typeof loadState !== 'function') throw new TypeError('loadState must be a function')

    let known = false
    let value = false
    let pending = null

    return {
        get known() {
            return known
        },
        get value() {
            return value
        },
        set(nextValue) {
            value = !!nextValue
            known = true
            return value
        },
        resolve() {
            if (known) return Promise.resolve(value)
            if (pending) return pending
            pending = Promise.resolve()
                .then(loadState)
                .then(loaded => {
                    // connected 帧比预读取更接近当前连接，不能被较慢的 HTTP 结果覆盖。
                    if (!known) {
                        value = !!loaded
                        known = true
                    }
                    return value
                })
                .finally(() => {
                    pending = null
                })
            return pending
        },
    }
}
