/**
 * opencode-proxy.mjs — Anthropic Messages → OpenAI Chat Completions 翻译代理
 *
 * OpenCode Zen /v1/messages 仅服务 Claude/Qwen；glm/deepseek/kimi/minimax/mimo
 * 等模型必须走 /chat/completions（OpenAI 端点）。
 * ccswitch 用 https://opencode.ai/zen/go 作 baseUrl，内部拼 /v1/chat/completions
 * 架构: claude.exe → 127.0.0.1:8788 → 本代理 → opencode.ai/zen/go/v1/chat/completions
 */

import {createServer} from 'node:http'
import {createLogger} from '../shared/logger.mjs'

const log = createLogger('opencode-proxy')

let proxyPort = 0
let proxyServer = null
let _startPromise = null

const UPSTREAM = 'https://opencode.ai/zen/go/v1/chat/completions'
const OC_PORT = parseInt(process.env.BRIDGE_OC_PORT, 10) || 8788
const MAX_PROXY_REQUEST_BYTES = 10 * 1024 * 1024
const MAX_PROXY_RESPONSE_BYTES = 20 * 1024 * 1024

export async function readLimitedNodeStream(stream, limit = MAX_PROXY_REQUEST_BYTES) {
    const chunks = []
    let total = 0
    const iterable = typeof stream.iterator === 'function'
        ? stream.iterator({destroyOnReturn: false})
        : stream
    for await (const chunk of iterable) {
        total += chunk.length
        if (total > limit) {
            const error = Object.assign(new Error('proxy payload too large'), {statusCode: 413})
            // 保留 HTTP 请求连接，让上层仍能返回规范的 413；剩余数据仅排空不再入内存。
            stream.resume?.()
            throw error
        }
        chunks.push(chunk)
    }
    return Buffer.concat(chunks)
}

async function readLimitedResponseText(response, limit = MAX_PROXY_RESPONSE_BYTES) {
    const declared = Number(response.headers.get('content-length') || 0)
    if (Number.isFinite(declared) && declared > limit) {
        await response.body?.cancel().catch(error => log.debug({err: error}, '取消超限上游响应失败'))
        throw Object.assign(new Error('proxy response too large'), {statusCode: 502})
    }
    if (!response.body) return ''
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    try {
        while (true) {
            const {done, value} = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > limit) throw Object.assign(new Error('proxy response too large'), {statusCode: 502})
            chunks.push(Buffer.from(value))
        }
    } catch (error) {
        await reader.cancel(error).catch(cancelError => log.debug({err: cancelError}, '取消上游响应读取失败'))
        throw error
    }
    return Buffer.concat(chunks).toString('utf8')
}

export function startOpenCodeProxy() {
    if (_startPromise) return _startPromise
    _startPromise = new Promise((resolve, reject) => {
        if (proxyServer) { resolve({server: proxyServer, port: proxyPort}); return }
        proxyServer = createServer(handleRequest)
        proxyServer.headersTimeout = 10_000
        proxyServer.requestTimeout = 30_000
        proxyServer.keepAliveTimeout = 5_000
        proxyServer.maxRequestsPerSocket = 1_000
        proxyServer.on('error', (e) => {
            if (e.code === 'EADDRINUSE') {
                // 固定端口被占 → 直接报错，不静默回退（与 deepseek-proxy 一致策略）
                proxyServer = null
                _startPromise = null
                reject(new Error(`端口 ${OC_PORT} 被占用，OpenCode 代理无法启动。请关闭占用 ${OC_PORT} 的进程后重启。`))
            } else { proxyServer = null; _startPromise = null; reject(e) }
        })
        proxyServer.listen(OC_PORT, '127.0.0.1', () => {
            proxyPort = OC_PORT; log.info({port: proxyPort}, 'OpenCode 代理已启动')
            resolve({server: proxyServer, port: proxyPort})
        })
    })
    return _startPromise
}
export function getOpenCodeProxyUrl() { return `http://127.0.0.1:${proxyPort}` }
export function isOpenCodeProxyRunning() { return proxyServer !== null && proxyServer.listening }
export function stopOpenCodeProxy() {
    // 重置 _startPromise：与 deepseek-proxy 一致，否则 stop→start 返回旧 resolved promise
    _startPromise = null
    if (proxyServer) { try { proxyServer.closeAllConnections?.(); proxyServer.close() } catch (error) { log.debug({err: error}, '非关键操作失败，已按降级路径继续') }; proxyServer = null; proxyPort = 0 }
}

async function handleRequest(clientReq, clientRes) {
    try {
        if (clientReq.method === 'GET' && clientReq.url === '/health') {
            clientRes.writeHead(200); clientRes.end('ok'); return
        }
        if (clientReq.method === 'GET' && clientReq.url?.startsWith('/v1/models')) {
            clientRes.writeHead(200, {'Content-Type':'application/json'})
            clientRes.end(JSON.stringify({object:'list', data:[
                {id:'deepseek-v4-pro'},{id:'deepseek-v4-flash'},{id:'glm-5.2'},{id:'glm-5.1'},
                {id:'kimi-k2.7-code'},{id:'kimi-k2.6'},{id:'kimi-k2.5'},
                {id:'minimax-m2.7'},{id:'minimax-m2.5'},{id:'mimo-v2.5-pro'},{id:'mimo-v2.5'},
                {id:'qwen3.7-max'},{id:'qwen3.6-plus'},{id:'qwen3.5-plus'},
            ]}))
            return
        }

        if (clientReq.method !== 'POST') {
            clientRes.writeHead(405, {'Allow': 'GET, POST'})
            clientRes.end('method not allowed')
            return
        }
        const rawBody = await readLimitedNodeStream(clientReq)
        if (rawBody.length === 0) { clientRes.writeHead(400); clientRes.end('empty body'); return }
        const body = JSON.parse(rawBody.toString('utf8'))
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            clientRes.writeHead(400); clientRes.end('invalid body'); return
        }
        log.info({model: body.model, msgs: body.messages?.length}, '→ opencode')

        const openai = translateBody(body)

        let apiKey = clientReq.headers['x-api-key'] || ''
        if (!apiKey) { const a = clientReq.headers['authorization'] || ''; apiKey = a.replace(/^Bearer\s+/i, '') }
        if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 8192 || /[\0\r\n]/.test(apiKey)) {
            clientRes.writeHead(401, {'Content-Type':'application/json'})
            clientRes.end(JSON.stringify({type:'error', error:{type:'authentication_error', message:'API key required'}}))
            return
        }

        const r = await fetch(UPSTREAM, {
            method: 'POST',
            headers: {'Content-Type':'application/json', 'Authorization':`Bearer ${apiKey}`, 'x-api-key': apiKey},
            body: JSON.stringify(openai),
            signal: AbortSignal.timeout(120000),
        })

        if (!r.ok) {
            const errText = await readLimitedResponseText(r).catch(() => '')
            log.warn({status: r.status, responseLength: errText.length}, 'upstream error')
            clientRes.writeHead(r.status, {'Content-Type':'application/json'})
            clientRes.end(JSON.stringify({type:'error',error:{type:'api_error',message:`HTTP ${r.status}: ${errText.slice(0, 200)}`}}))
            return
        }

        const respText = await readLimitedResponseText(r)
        let data
        try { data = JSON.parse(respText) } catch { data = null }
        if (!data || data.error) {
            const msg = data?.error?.message || `Bad response: ${respText.slice(0,200)}`
            log.warn({status: r.status, responseLength: respText.length}, 'upstream 非 JSON 或错误')
            clientRes.writeHead(r.status||502, {'Content-Type':'application/json'})
            clientRes.end(JSON.stringify({type:'error',error:{type:'api_error',message:msg}}))
            return
        }
        const translated = translateResponse(data, body.model)
        if (body.stream === true) {
            clientRes.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
            })
            clientRes.end(toAnthropicSse(translated))
            return
        }
        clientRes.writeHead(200, {'Content-Type':'application/json'})
        clientRes.end(JSON.stringify(translated))

    } catch(e) {
        log.error({err: e}, 'proxy error')
        if (!clientRes.headersSent) {
            clientRes.writeHead(e.statusCode || (e instanceof SyntaxError ? 400 : 500), {'Content-Type':'application/json'})
            clientRes.end(JSON.stringify({error:{message:e.statusCode === 413 ? 'payload too large' : e.message}}))
        } else {
            clientRes.destroy(e)
        }
    }
}

// ── 翻译入口 ──
export function translateBody(body) {
    // 上游固定请求完整 JSON；客户端要求流式时由本代理转换为有限 Anthropic SSE 事件序列。
    const o = { model: body.model, max_tokens: body.max_tokens || 32000, stream: false }
    const msgs = []
    if (body.system) {
        const s = Array.isArray(body.system) ? body.system.filter(b=>b.type==='text').map(b=>b.text).join('') : String(body.system)
        if (s) msgs.push({role:'system', content:s})
    }
    for (const m of body.messages||[]) {
        if (m.role === 'user') { const r = transUser(m); Array.isArray(r) ? msgs.push(...r) : msgs.push(r) }
        else if (m.role === 'assistant') msgs.push(transAssistant(m))
    }
    o.messages = msgs
    if (body.tools?.length) {
        o.tools = body.tools.map(t => ({type:'function',function:{name:t.name,description:t.description||'',parameters:t.input_schema||{}}}))
        o.tool_choice = 'auto'
    }
    return o
}
function transUser(m) {
    if (typeof m.content === 'string') return {role:'user', content:m.content}
    if (!Array.isArray(m.content)) return {role:'user', content:String(m.content||'')}
    const trs = m.content.filter(b=>b.type==='tool_result')
    if (trs.length > 0 && m.content.length === trs.length) {
        return trs.map(tr => ({role:'tool', tool_call_id:tr.tool_use_id, content:typeof tr.content==='string'?tr.content:JSON.stringify(tr.content)}))
    }
    const out = []
    for (const b of m.content) {
        if (b.type==='tool_result') out.push({role:'tool',tool_call_id:b.tool_use_id,content:typeof b.content==='string'?b.content:JSON.stringify(b.content)})
        else if (b.type==='text') out.push({role:'user',content:b.text})
    }
    return out.length===1 ? out[0] : out
}
function transAssistant(m) {
    if (typeof m.content === 'string') return {role:'assistant',content:m.content}
    if (!Array.isArray(m.content)) return {role:'assistant',content:''}
    const texts=[], tcs=[]
    for (const b of m.content) {
        if (b.type==='text') texts.push(b.text)
        else if (b.type==='tool_use') tcs.push({id:b.id,type:'function',function:{name:b.name,arguments:typeof b.input==='string'?b.input:JSON.stringify(b.input)}})
    }
    const r = {role:'assistant'}
    // OpenAI 规范要求 assistant.content 为 string（含 tool_calls 时也用空串），不接 null
    if (texts.length) r.content = texts.join('')
    else r.content = ''
    if (tcs.length) r.tool_calls = tcs
    return r
}
export function translateResponse(data, model) {
    const c = data.choices?.[0]
    if (!c) return {id:data.id||'m0',type:'message',role:'assistant',model,content:[{type:'text',text:''}],stop_reason:'end_turn',usage:u(data.usage)}
    const content = []
    if (c.message?.content) content.push({type:'text',text:c.message.content})
    if (c.message?.tool_calls) {
        for (const tc of c.message.tool_calls) {
            let input; try{input=JSON.parse(tc.function.arguments)}catch{input={}}
            content.push({type:'tool_use',id:tc.id,name:tc.function.name,input})
        }
    }
    let sr = 'end_turn'
    if (c.finish_reason==='tool_calls') sr='tool_use'
    else if (c.finish_reason==='length') sr='max_tokens'
    return {id:data.id||'m'+Date.now(),type:'message',role:'assistant',model,content,stop_reason:sr,usage:u(data.usage)}
}

function sseEvent(type, data) {
    return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

/** 将完整 Anthropic Message 转为顺序完整的 SSE 事件，不拆分 UTF-8 字符。 */
export function toAnthropicSse(message) {
    const usage = message.usage || {input_tokens: 0, output_tokens: 0}
    let output = sseEvent('message_start', {
        type: 'message_start',
        message: {
            id: message.id,
            type: 'message',
            role: 'assistant',
            model: message.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {input_tokens: usage.input_tokens || 0, output_tokens: 0},
        },
    })
    for (let index = 0; index < (message.content || []).length; index++) {
        const block = message.content[index]
        if (block.type === 'tool_use') {
            output += sseEvent('content_block_start', {
                type: 'content_block_start', index,
                content_block: {type: 'tool_use', id: block.id, name: block.name, input: {}},
            })
            output += sseEvent('content_block_delta', {
                type: 'content_block_delta', index,
                delta: {type: 'input_json_delta', partial_json: JSON.stringify(block.input || {})},
            })
        } else {
            output += sseEvent('content_block_start', {
                type: 'content_block_start', index,
                content_block: {type: 'text', text: ''},
            })
            output += sseEvent('content_block_delta', {
                type: 'content_block_delta', index,
                delta: {type: 'text_delta', text: String(block.text || '')},
            })
        }
        output += sseEvent('content_block_stop', {type: 'content_block_stop', index})
    }
    output += sseEvent('message_delta', {
        type: 'message_delta',
        delta: {stop_reason: message.stop_reason || 'end_turn', stop_sequence: null},
        usage: {output_tokens: usage.output_tokens || 0},
    })
    output += sseEvent('message_stop', {type: 'message_stop'})
    return output
}
function u(usage) { return usage ? {input_tokens:usage.prompt_tokens||0,output_tokens:usage.completion_tokens||0} : {input_tokens:0,output_tokens:0} }
