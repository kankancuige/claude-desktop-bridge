export function startNotificationWorker({outbox, deliver, log, intervalMs = 30_000} = {}) {
    if (!outbox || typeof deliver !== 'function') throw new TypeError('outbox and deliver are required')
    let running = false
    let stopped = false

    const flush = async () => {
        if (running || stopped) return
        running = true
        try {
            for (const entry of outbox.due()) {
                if (stopped) break
                try {
                    const delivered = await deliver(entry.payload)
                    if (stopped) break
                    const persisted = delivered
                        ? outbox.complete(entry.id)
                        : outbox.fail(entry.id, 'send_failed')
                    if (persisted === false) {
                        log?.error?.({notificationId: entry.id}, '通知状态持久化失败')
                    }
                } catch (error) {
                    if (stopped) break
                    const persisted = outbox.fail(entry.id, error)
                    if (persisted === false) {
                        log?.error?.({notificationId: entry.id}, '通知失败状态持久化失败')
                    }
                    log?.warn?.({err: error, notificationId: entry.id}, '通知重试失败')
                }
            }
        } finally {
            running = false
        }
    }

    const reportFlushFailure = (error) => log?.warn?.({err: error}, '通知 outbox 扫描失败')
    const timer = setInterval(() => { flush().catch(reportFlushFailure) }, intervalMs)
    timer.unref?.()
    queueMicrotask(() => { flush().catch(reportFlushFailure) })
    return {
        flush,
        stop: () => {
            stopped = true
            clearInterval(timer)
        },
        summary: () => outbox.summary(),
    }
}

export async function sendOrQueue(outbox, payload, deliver, {leaseMs = 30_000, id: requestedId} = {}) {
    // 先持久化并设置发送租约，覆盖进程在平台请求期间崩溃导致通知永久丢失的窗口。
    let id = null
    let persistError = null
    try {
        const enqueueOptions = requestedId === undefined ? {deferMs: leaseMs} : {id: requestedId, deferMs: leaseMs}
        const enqueued = outbox.enqueue(payload, enqueueOptions)
        if (typeof enqueued === 'string') id = enqueued
        else if (enqueued?.id) {
            id = enqueued.id
            if (enqueued.duplicate) {
                return {sent: enqueued.state === 'sent', queued: enqueued.state !== 'sent', id, duplicate: true}
            }
        }
    } catch (error) {
        persistError = error
    }
    try {
        if (await deliver(payload)) {
            const persisted = id ? outbox.complete(id) : false
            return {
                sent: true,
                queued: !!id && persisted === false,
                ...(id ? {id} : {}),
                ...(persisted === false ? {error: id ? 'outbox_complete_failed' : String(persistError?.message || 'outbox_persist_failed')} : {}),
            }
        }
    } catch (error) {
        if (id) outbox.fail(id, error)
        return {sent: false, queued: !!id, ...(id ? {id} : {}), error: String(error?.message || error || 'send_failed')}
    }
    if (id) outbox.fail(id, 'send_failed')
    return {sent: false, queued: !!id, ...(id ? {id} : {}), ...(!id ? {error: String(persistError?.message || 'outbox_persist_failed')} : {})}
}
