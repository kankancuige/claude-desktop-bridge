function safeNumber(value) {
    return Number.isFinite(value) ? value : null
}

export function classifyWeChatSendStatus(response, body = {}) {
    const status = safeNumber(response?.status)
    const ret = safeNumber(body?.ret)
    const errcode = safeNumber(body?.errcode)
    return {
        ok: response?.ok === true && (ret === null || ret === 0) && (errcode === null || errcode === 0),
        status,
        ret,
        errcode,
    }
}
