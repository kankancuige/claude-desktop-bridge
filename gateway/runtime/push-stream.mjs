/** SDK 输入流队列，不拥有 Session 或任务状态。 */
export class PushStream {
    constructor() {
        this._buf = []
        this._resolve = null
        this._closed = false
    }

    push(message) {
        if (this._closed) return false
        if (this._resolve) {
            this._resolve({value: message, done: false})
            this._resolve = null
        } else this._buf.push(message)
        return true
    }

    close() {
        if (this._closed) return false
        this._closed = true
        if (this._resolve) {
            this._resolve({value: undefined, done: true})
            this._resolve = null
        }
        return true
    }

    [Symbol.asyncIterator]() {
        const stream = this
        return {
            next() {
                if (stream._buf.length) return Promise.resolve({value: stream._buf.shift(), done: false})
                if (stream._closed) return Promise.resolve({value: undefined, done: true})
                return new Promise(resolve => { stream._resolve = resolve })
            },
        }
    }
}
