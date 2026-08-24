function json(res, status, body) {
    res.writeHead(status, {'Content-Type': 'application/json'})
    res.end(JSON.stringify(body))
}

export function createProviderConfigRoutes(deps = {}) {
    const {dynamicCache, getLiveQuery, withTimeout, persistDynamicCache, loadCliSettings, fetchProviderResponse, validateProviderUrl, buildProviderModelsUrl, buildProviderFallbackUrls, providers: PROVIDERS, readBody, log, restoreSecretValue} = deps
    return async function handleProviderConfigRoute({req, res, url}) {
        if (req.method === 'GET' && url.pathname === '/api/config/providers') {
            json(res, 200, {providers: PROVIDERS})
            return true
        }
    // 动态模型列表：活跃 query 调 supportedModels()，缓存供冷启动；拿不到回退缓存
    // ── GET /api/config/models —— 动态模型列表 ──
    // 功能说明: 通过活跃 query 调用 supportedModels() 获取模型列表（含 value/displayName/description）
    //   有活跃 query 时实时获取并刷新缓存；没有则回退到 dynamicCache 缓存的模型数据
    // 实现方式: getLiveQuery() → withTimeout(q.supportedModels(), 5s) → 更新 dynamicCache + 持久化
    //   5 秒超时保护防止 hang；冷启动无活跃 query 时用磁盘/内存缓存
    // 关键数据流: GET → getLiveQuery() → supportedModels() → dynamicCache.models 更新 + 持久化 → 200 {models, live, cachedAt}
    if (req.method === 'GET' && url.pathname === '/api/config/models') {
        const q = getLiveQuery()
        if (q) {
            try {
                const models = await withTimeout(q.supportedModels(), 5000)  // [{value,displayName,description}]
                if (Array.isArray(models) && models.length) {
                    dynamicCache.models = models;
                    dynamicCache.updatedAt = Date.now();
                    persistDynamicCache()
                }
            } catch (e) {
                log.warn({err: e}, 'supportedModels 失败')
            }
        }
        res.writeHead(200);
        res.end(JSON.stringify({models: dynamicCache.models || [], live: !!q, cachedAt: dynamicCache.updatedAt}));
            return true
    }
    // OpenAI 兼容供应商(DeepSeek/OpenAI)的真实模型列表：用配置的 key 调其 /models 接口
    // ── POST /api/config/live-models —— OpenAI 兼容供应商真实模型列表 ──
    // 功能说明: 用请求体中的 baseUrl+apiKey 调供应商的 /models 接口获取真实可用的模型 ID 列表
    // 实现方式: 不同供应商 models 端点位置不同，按 baseUrl 特征判断
    //   8 秒超时保护；失败返回 {models:[], error:...}
    // 关键数据流: POST {baseUrl, apiKey} → 判断供应商 → fetch models 端点 → 解析 data[] → 200 {models, source}
    if (req.method === 'POST' && url.pathname === '/api/config/live-models') {
        try {
            const cliS = loadCliSettings()
            const b = await readBody(req)
            const qBaseUrl = b.baseUrl || ''
            const storedApiKey = cliS.env?.ANTHROPIC_AUTH_TOKEN || cliS.env?.ANTHROPIC_API_KEY || ''
            const qApiKey = restoreSecretValue(b.apiKey || '', storedApiKey)
            // 不再读 process.env：该端点面向 settings 配置查询，cliS.env 已覆盖；临时切换 provider 不经此路径
            const baseUrl = qBaseUrl || cliS.env?.ANTHROPIC_BASE_URL || ''
            const key = qApiKey || storedApiKey
            if (!baseUrl || !key) {
                res.writeHead(200);
                res.end(JSON.stringify({models: [], error: 'no_creds'}));
            return true
            }
            if (/\/api\/codex\/backend-api\/codex(?:\/|$)/i.test(baseUrl)) {
                const preset = PROVIDERS.find(provider => provider.id === 'codex-relay')
                const models = (preset?.models || []).map(model => ({value: model.id, displayName: model.name, description: model.contextWindow}))
                res.writeHead(200)
                res.end(JSON.stringify({models, source: 'codex-relay-preset'}))
            return true
            }
            // 不同供应商 /models 端点位置不同
            let modelsUrl
            if (baseUrl.includes('dashscope.aliyuncs.com')) {
                modelsUrl = baseUrl.replace(/\/apps\/anthropic\/?$/, '/compatible-mode/v1/models')
            } else if (baseUrl.endsWith('/v1/messages')) {
                modelsUrl = baseUrl.replace(/\/v1\/messages\/?$/, '/v1/models')
            } else if (baseUrl && baseUrl.includes('opencode')) {
                modelsUrl = baseUrl.replace(/\/+$/, '').replace(/\/zen\/v\d+/, '/zen/go/v1') + '/models'
            } else if (baseUrl && baseUrl.includes('minimax')) {
                // MiniMax /anthropic 是 Anthropic 兼容端点，/models 在 OpenAI 兼容路径下
                modelsUrl = baseUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '') + '/v1/models'
            } else {
                modelsUrl = baseUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '') + '/models'
            }
            modelsUrl = buildProviderModelsUrl(baseUrl)
            const providerUrl = await validateProviderUrl(baseUrl)
            await validateProviderUrl(modelsUrl)
            let fetched = await fetchProviderResponse(modelsUrl, {
                headers: {Authorization: `Bearer ${key}`},
                signal: AbortSignal.timeout(8000)
            })
            let r = fetched.response
            modelsUrl = fetched.url
            // 404/403 回退：部分供应商 models 不在根路径
            if (!r.ok && (r.status === 404 || r.status === 403)) {
                try {
                    const candidates = buildProviderFallbackUrls(providerUrl.toString())
                    // 候选：pathBase/v1/models > parentPath/v1/models > origin/v1/models
                    for (const fb of candidates) {
                        if (fb === modelsUrl) continue
                        await validateProviderUrl(fb)
                        const fallback = await fetchProviderResponse(fb, {
                            headers: {Authorization: `Bearer ${key}`},
                            signal: AbortSignal.timeout(8000)
                        })
                        if (fallback.response.ok) { r = fallback.response; modelsUrl = fallback.url; break }
                    }
                } catch (error) {
                    log.debug({err: error, modelsUrl}, '供应商模型端点回退失败')
                }
            }
            if (!r.ok) {
                res.writeHead(200);
                res.end(JSON.stringify({models: [], error: `http_${r.status}`}));
            return true
            }
            const d = await r.json()
            const models = (d.data || []).map(m => ({value: m.id, displayName: m.id}))
            res.writeHead(200);
            res.end(JSON.stringify({models, source: modelsUrl}));
            return true
        } catch (e) {
            res.writeHead(200);
            res.end(JSON.stringify({models: [], error: String(e?.message || e)}));
            return true
        }
    }
    // 供应商连接测试：用请求体中的 baseUrl+apiKey 调 /models 验证连通性
    // ── POST /api/config/test-model —— 供应商连接测试 ──
    // 功能说明: 用请求体中的 baseUrl+apiKey 调供应商 /models 接口验证连通性
    //   返回 ok 状态 + 可选的前 10 个模型 ID 列表，失败时返回 HTTP 状态码和响应摘要
    // 关键数据流: POST {baseUrl, apiKey} → fetch {origin}/models → 200 {ok:true, count, list} 或 {ok:false, error}
    if (req.method === 'POST' && url.pathname === '/api/config/test-model') {
        try {
            const b = await readBody(req)
            const cliS = loadCliSettings()
            const qBaseUrl = b.baseUrl || ''
            const storedApiKey = cliS.env?.ANTHROPIC_AUTH_TOKEN || cliS.env?.ANTHROPIC_API_KEY || ''
            const qApiKey = restoreSecretValue(b.apiKey || '', storedApiKey)
            if (!qBaseUrl || !qApiKey) {
                res.writeHead(200);
                res.end(JSON.stringify({ok: false, error: 'missing baseUrl or apiKey'}));
            return true
            }
            if (/\/api\/codex\/backend-api\/codex(?:\/|$)/i.test(qBaseUrl)) {
                const model = typeof b.model === 'string' && /^(?:gpt-|o\d|codex|computer-use)/i.test(b.model) ? b.model : 'gpt-5.6-sol'
                const responsesUrl = qBaseUrl.replace(/\/+$/, '') + '/responses'
                await validateProviderUrl(responsesUrl)
                const probe = await fetchProviderResponse(responsesUrl, {
                    method: 'POST',
                    headers: {Authorization: `Bearer ${qApiKey}`, 'Content-Type': 'application/json'},
                    body: JSON.stringify({model, input: 'Reply with OK only.', stream: false, store: false, max_output_tokens: 4}),
                    signal: AbortSignal.timeout(15000),
                })
                if (!probe.response.ok) {
                    const detail = (await probe.response.text()).slice(0, 300)
                    res.writeHead(200)
                    res.end(JSON.stringify({ok: false, error: `HTTP ${probe.response.status} ${detail}`}))
            return true
                }
                res.writeHead(200)
                res.end(JSON.stringify({ok: true, count: 1, list: [model], source: responsesUrl}))
            return true
            }
            // 不同供应商 /models 端点位置不同
            let modelsUrl
            if (qBaseUrl.includes('dashscope.aliyuncs.com')) {
                modelsUrl = qBaseUrl.replace(/\/apps\/anthropic\/?$/, '/compatible-mode/v1/models')
            } else if (qBaseUrl.endsWith('/v1/messages')) {
                modelsUrl = qBaseUrl.replace(/\/v1\/messages\/?$/, '/v1/models')
            } else if (qBaseUrl && qBaseUrl.includes('opencode')) {
                modelsUrl = qBaseUrl.replace(/\/+$/, '').replace(/\/zen\/v\d+/, '/zen/go/v1') + '/models'
            } else if (qBaseUrl && qBaseUrl.includes('minimax')) {
                modelsUrl = qBaseUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '') + '/v1/models'
            } else {
                modelsUrl = qBaseUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '') + '/models'
            }
            modelsUrl = buildProviderModelsUrl(qBaseUrl)
            const providerUrl = await validateProviderUrl(qBaseUrl)
            await validateProviderUrl(modelsUrl)
            let fetched = await fetchProviderResponse(modelsUrl, {
                headers: {Authorization: `Bearer ${qApiKey}`},
                signal: AbortSignal.timeout(10000)
            })
            let r = fetched.response
            modelsUrl = fetched.url
            // 404/403 回退：部分供应商 models 不在根路径
            if (!r.ok && (r.status === 404 || r.status === 403)) {
                try {
                    // 候选：pathBase/v1/models > parentPath/v1/models > origin/v1/models
                    const candidates = buildProviderFallbackUrls(providerUrl.toString())
                    for (const fb of candidates) {
                        if (fb === modelsUrl) continue
                        await validateProviderUrl(fb)
                        const fallback = await fetchProviderResponse(fb, {
                            headers: {Authorization: `Bearer ${qApiKey}`},
                            signal: AbortSignal.timeout(10000)
                        })
                        if (fallback.response.ok) { r = fallback.response; modelsUrl = fallback.url; break }
                    }
                } catch (error) {
                    log.debug({err: error, modelsUrl}, '测试供应商模型端点回退失败')
                }
            }
            if (!r.ok) {
                let detail = `HTTP ${r.status}`
                try {
                    const b = await r.text();
                    if (b) detail += ` — ${b.slice(0, 200)}`
                } catch (error) {
                    log.debug({err: error, modelsUrl}, '读取供应商错误响应失败')
                }
                res.writeHead(200);
                res.end(JSON.stringify({ok: false, error: detail}));
            return true
            }
            const d = await r.json()
            const count = Array.isArray(d.data) ? d.data.length : 0
            const list = Array.isArray(d.data) ? d.data.slice(0, 10).map(m => m.id) : []
            res.writeHead(200);
            res.end(JSON.stringify({ok: true, count, list, source: modelsUrl}));
            return true
        } catch (e) {
            res.writeHead(200);
            res.end(JSON.stringify({ok: false, error: String(e?.message || e)}));
            return true
        }
    }

        return false
    }
}
