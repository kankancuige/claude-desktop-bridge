/**
 * 余额能力只对明确支持的供应商启用。
 * 供应商的模型调用地址与余额地址不是同一个契约，不能因为有 API key
 * 就把任意 token 发送到 DeepSeek 的余额接口。
 */
export function resolveBalanceProvider(baseUrl) {
    const value = typeof baseUrl === 'string' ? baseUrl.trim() : ''
    const normalized = value.toLowerCase()
    if (!value) {
        return {id: 'unknown', supported: false, reason: 'missing_base_url', message: '未配置供应商地址'}
    }
    if (normalized.includes('deepseek')) {
        return {id: 'deepseek', supported: true, endpoint: 'https://api.deepseek.com/user/balance'}
    }
    if (/https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(value)) {
        return {id: 'local-proxy', supported: false, reason: 'local_proxy', message: '当前使用本地代理，余额由代理供应商管理'}
    }
    if (normalized.includes('codex') || normalized.includes('aicodemirror') || normalized.includes('claudecode.net.cn')) {
        return {id: 'codex-relay', supported: false, reason: 'provider_unsupported', message: '当前 Codex 中转站未提供通用余额接口'}
    }
    return {id: 'custom', supported: false, reason: 'provider_unsupported', message: '当前供应商未提供通用余额接口'}
}

export function parseDeepSeekBalance(payload) {
    const info = payload?.balance_infos?.[0]
    const amount = Number.parseFloat(String(info?.total_balance ?? '0'))
    return {
        balance: Number.isFinite(amount) ? amount : 0,
        currency: typeof info?.currency === 'string' && info.currency ? info.currency : 'CNY',
    }
}
