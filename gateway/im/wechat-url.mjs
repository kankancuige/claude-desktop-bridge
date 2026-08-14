const WECHAT_HOSTS = new Set(['ilinkai.weixin.qq.com'])

export function normalizeWeChatBaseUrl(value) {
    const candidate = String(value || 'https://ilinkai.weixin.qq.com').trim()
    let parsed
    try {
        parsed = new URL(candidate)
    } catch {
        return 'https://ilinkai.weixin.qq.com/'
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !WECHAT_HOSTS.has(parsed.hostname.toLowerCase())) {
        return 'https://ilinkai.weixin.qq.com/'
    }
    return `${parsed.origin}/`
}
