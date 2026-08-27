/**
 * 按顺序发送已切分文本，并在段之间留出平台限流窗口。
 * 发送失败的段仍继续处理，交由调用方根据结果写入 outbox。
 */
export async function sendTextParts({text, split, sendPart, delay = async () => {}, delayMs = 0, formatPart = null} = {}) {
    if (typeof split !== 'function' || typeof sendPart !== 'function') throw new TypeError('split and sendPart are required')
    const parts = split(text)
    let sent = true
    let queued = false
    let lastError = ''
    for (let index = 0; index < parts.length; index++) {
        const content = typeof formatPart === 'function'
            ? formatPart(parts[index], index, parts.length)
            : parts.length > 1 ? `【${index + 1}/${parts.length}】${parts[index]}` : parts[index]
        const result = await sendPart(content, index, parts.length)
        if (!result?.sent) sent = false
        if (result?.queued) queued = true
        if (result?.error) lastError = result.error
        if (index < parts.length - 1 && delayMs > 0) await delay(delayMs)
    }
    return {sent, queued: !sent && queued, error: lastError, parts: parts.length}
}
