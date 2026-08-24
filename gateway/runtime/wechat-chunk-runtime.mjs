const WX_MAX_BYTES = 3500
const WX_MARKER_RESERVE = 16

/** 微信消息按 UTF-8 字节安全分段，并顺序发送。 */
export function createWeChatChunkRuntime({fetchImpl = globalThis.fetch, delay = ms => new Promise(resolve => setTimeout(resolve, ms)), maxBytes = WX_MAX_BYTES, markerReserve = WX_MARKER_RESERVE} = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')

    function splitByBytes(value, limit) {
        const result = []
        let current = ''
        let size = 0
        for (const character of String(value)) {
            const bytes = Buffer.byteLength(character, 'utf8')
            if (size + bytes > limit && current) {
                result.push(current)
                current = ''
                size = 0
            }
            current += character
            size += bytes
        }
        if (current) result.push(current)
        return result.length ? result : ['']
    }

    async function sendWeChatChunks(baseUrl, token, userId, contextToken, fullText) {
        const parts = splitByBytes(fullText, maxBytes - markerReserve)
        const total = parts.length
        const messageState = contextToken ? 2 : 1
        let sent = true
        for (let index = 0; index < total; index++) {
            const body = total > 1 ? `【${index + 1}/${total}】\n${parts[index]}` : parts[index]
            try {
                const response = await fetchImpl(`${baseUrl}ilink/bot/sendmessage`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json', 'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': '853081', Authorization: `Bearer ${token}`, AuthorizationType: 'ilink_bot_token'},
                    body: JSON.stringify({msg: {from_user_id: '', to_user_id: userId, client_id: `gw-${Date.now()}-${index}`, message_type: 2, message_state: messageState, context_token: contextToken || '', item_list: [{type: 1, text_item: {text: body}}]}, base_info: {channel_version: '0.1.0'}}),
                    signal: AbortSignal.timeout(10000),
                })
                const data = await response.json()
                if (!(response.ok && (!data.ret || data.ret === 0))) sent = false
            } catch {
                sent = false
            }
            if (index < total - 1) await delay(400)
        }
        return {sent, parts: total}
    }

    return {splitByBytes, sendWeChatChunks}
}
