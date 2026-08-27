/** 将下游 HTTP 连接生命周期转换为可传给 Provider 请求的 AbortSignal。 */
export function createProviderClientLifecycle(clientReq, clientRes) {
    const controller = new AbortController()
    let disposed = false

    const cleanup = () => {
        clientReq.removeListener('aborted', onDisconnect)
        clientRes.removeListener('close', onDisconnect)
    }
    const onDisconnect = () => {
        if (disposed || clientRes.writableEnded) return
        disposed = true
        cleanup()
        controller.abort(new Error('client disconnected'))
    }

    clientReq.once('aborted', onDisconnect)
    clientRes.once('close', onDisconnect)

    return {
        signal: controller.signal,
        finish() {
            if (disposed) return
            disposed = true
            cleanup()
        },
    }
}
