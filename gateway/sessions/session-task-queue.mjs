/**
 * 按 Session 串行执行外部入口任务。
 *
 * IM 适配器会为每条消息建立一个 WS 监听器。若同一 Session 同时注入多条消息，
 * 每个监听器都会收到同一个 result，导致回复串线；这里保证一个 Session 同时只有
 * 一个 injectAndWait，后续消息按 FIFO 顺序等待。
 */
export class SessionTaskQueue {
    constructor({maxDepth = 8} = {}) {
        if (!Number.isInteger(maxDepth) || maxDepth < 1) throw new TypeError('maxDepth must be a positive integer')
        this.maxDepth = maxDepth
        this._states = new Map()
    }

    depth(key) {
        return this._states.get(String(key))?.depth || 0
    }

    enqueue(key, task) {
        if (typeof task !== 'function') return Promise.reject(new TypeError('task must be a function'))
        const normalizedKey = String(key || '')
        if (!normalizedKey) return Promise.reject(new TypeError('session key is required'))
        let state = this._states.get(normalizedKey)
        if (!state) {
            state = {tail: Promise.resolve(), depth: 0, generation: 0, nextOrder: 0, cancelFromOrder: Infinity}
            this._states.set(normalizedKey, state)
        }
        if (state.depth >= this.maxDepth) {
            const error = new Error('session queue is full')
            error.code = 'queue_full'
            error.queueDepth = state.depth
            return Promise.reject(error)
        }
        state.depth++
        const generation = state.generation
        const order = state.nextOrder++
        const execution = state.tail.then(() => {
            if (generation !== state.generation && order >= state.cancelFromOrder) {
                const error = new Error('queued session task was cancelled')
                error.code = 'session_cancelled'
                throw error
            }
            return task()
        })
        // tail 永远保持 resolved，单个任务失败不能阻塞后续消息，也不能产生未处理 rejection。
        const cleanup = () => {
            state.depth--
            if (state.depth === 0 && this._states.get(normalizedKey) === state) this._states.delete(normalizedKey)
        }
        const settled = execution.then(
            value => { cleanup(); return value },
            error => { cleanup(); throw error },
        )
        // tail 只作为串行屏障；调用方仍持有 settled 并接收原始错误，避免形成未处理 rejection。
        state.tail = settled.then(() => undefined, () => undefined)
        return settled
    }

    cancel(key) {
        const state = this._states.get(String(key || ''))
        if (!state) return 0
        // 每个 Session 最多一个正在执行的任务；保留队首，仅取消其后的待处理项。
        state.cancelFromOrder = Math.max(0, state.nextOrder - state.depth + 1)
        state.generation++
        return state.depth
    }

    cancelAll() {
        let cancelled = 0
        for (const key of this._states.keys()) cancelled += this.cancel(key)
        return cancelled
    }
}
