function baseNotificationId(id) {
    return String(id || '').replace(/:part:\d+$/, '')
}

function deliverySucceeded(result) {
    return result === true || result?.sent === true
}

function deliveryError(result) {
    return result?.error || 'send_failed'
}

export function startNotificationWorker({outbox, deliver, log, onStateChange = null, intervalMs = 30_000, delay = ms => new Promise(resolve => setTimeout(resolve, ms)), delayMs = 0} = {}) {
    if (!outbox || typeof deliver !== 'function') throw new TypeError('outbox and deliver are required')
    let runningPromise = null
    let rerunRequested = false
    let stopped = false
    const emitState = async event => {
        if (typeof onStateChange !== 'function') return
        try {
            await onStateChange(event)
        } catch (error) {
            log?.warn?.({err: error, notificationId: event?.notificationId}, '通知任务投影回写失败')
        }
    }

    const runFlush = async () => {
        do {
            rerunRequested = false
            const due = outbox.due()
            for (let index = 0; index < due.length; index++) {
                const entry = due[index]
                if (stopped) break
                try {
                    const delivered = await deliver(entry.payload)
                    if (stopped) break
                    const persisted = deliverySucceeded(delivered)
                        ? outbox.complete(entry.id)
                        : outbox.fail(entry.id, deliveryError(delivered))
                    if (persisted === false) {
                        log?.error?.({notificationId: entry.id}, '通知状态持久化失败')
                    } else {
                        const current = outbox.status?.(baseNotificationId(entry.id))
                        await emitState({
                            notificationId: baseNotificationId(entry.id),
                            partId: entry.id,
                            state: current?.state || (deliverySucceeded(delivered) ? 'sent' : 'failed'),
                            lastError: current?.lastError || (deliverySucceeded(delivered) ? '' : deliveryError(delivered)),
                        })
                    }
                } catch (error) {
                    if (stopped) break
                    const persisted = outbox.fail(entry.id, error)
                    if (persisted === false) {
                        log?.error?.({notificationId: entry.id}, '通知失败状态持久化失败')
                    } else {
                        const current = outbox.status?.(baseNotificationId(entry.id))
                        await emitState({
                            notificationId: baseNotificationId(entry.id),
                            partId: entry.id,
                            state: current?.state || 'failed',
                            lastError: current?.lastError || String(error?.message || error || 'send_failed'),
                        })
                    }
                    log?.warn?.({err: error, notificationId: entry.id}, '通知重试失败')
                }
                if (!stopped && index < due.length - 1 && delayMs > 0) await delay(delayMs)
            }
        } while (rerunRequested && !stopped)
    }

    const flush = () => {
        if (stopped) return Promise.resolve()
        if (runningPromise) {
            rerunRequested = true
            return runningPromise
        }
        runningPromise = runFlush().finally(() => { runningPromise = null })
        return runningPromise
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
    let delivered
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
        delivered = await deliver(payload)
        if (deliverySucceeded(delivered)) {
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
    const error = id ? deliveryError(delivered) : String(persistError?.message || 'outbox_persist_failed')
    if (id) outbox.fail(id, error)
    return {sent: false, queued: !!id, ...(id ? {id} : {}), error: id ? error : String(persistError?.message || error)}
}
