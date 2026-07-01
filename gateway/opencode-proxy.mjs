/**
 * opencode-proxy.mjs — Anthropic Messages → OpenAI Chat Completions 翻译代理
 *
 * OpenCode Zen /v1/messages 仅服务 Claude/Qwen；glm/deepseek/kimi/minimax/mimo
 * 等模型必须走 /chat/completions（OpenAI 端点）。
 * ccswitch 用 https://opencode.ai/zen/go 作 baseUrl，内部拼 /v1/chat/completions
 * 架构: claude.exe → 127.0.0.1:8788 → 本代理 → opencode.ai/zen/go/v1/chat/completions
 */

import {createServer} from 'node:http'
import {createLogger} from './logger.mjs'

const log = createLogger('opencode-proxy')

let proxyPort = 0
let proxyServer = null
let _startPromise = null

const UPSTREAM = 'https://opencode.ai/zen/go/v1/chat/completions'

export function startOpenCodeProxy() {
    if (_startPromise) return _startPromise
    _startPromise = new Promise((resolve, reject) => {
        if (proxyServer) { resolve({server: proxyServer, port: proxyPort}); return }
        proxyServer = createServer(handleRequest)
        proxyServer.on('error', (e) => {
            if (e.code === 'EADDRINUSE') {
                // 固定端口被占 → 直接报错，不静默回退（与 deepseek-proxy 一致策略）
                proxyServer = null
                _startPromise = null
                reject(new Error('端口 8788 被占用，OpenCode 代理无法启动。请关闭占用 8788 的进程后重启。'))
            } else { proxyServer = null; _startPromise = null; reject(e) }
        })
        proxyServer.listen(8788, '127.0.0.1', () => {
            proxyPort = 8788; log.info({port: proxyPort}, 'OpenCode 代理已启动')
            resolve({server: proxyServer, port: proxyPort})
        })
    })
    return _startPromise
}
export function getOpenCodeProxyUrl() { return `http://127.0.0.1:${proxyPort}` }
export function isOpenCodeProxyRunning() { return proxyServer !== null && proxyServer.listening }
export function stopOpenCodeProxy() {
    if (proxyServer) { try { proxyServer.closeAllConnections?.(); proxyServer.close() } catch {}; proxyServer = null; proxyPort = 0 }
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

        // 读取请求体（HEAD 请求无 body 跳过）
        if (clientReq.method === 'HEAD') return
        const chunks = []
        for await (const c of clientReq) chunks.push(c)
        if (chunks.length === 0) { clientRes.writeHead(400); clientRes.end('empty body'); return }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        log.info({model: body.model, msgs: body.messages?.length}, '→ opencode')

        const openai = translateBody(body)

        let apiKey = clientReq.headers['x-api-key'] || ''
        if (!apiKey) { const a = clientReq.headers['authorization'] || ''; apiKey = a.replace(/^Bearer\s+/i, '') }

        const r = await fetch(UPSTREAM, {
            method: 'POST',
            headers: {'Content-Type':'application/json', 'Authorization':`Bearer ${apiKey}`, 'x-api-key': apiKey},
            body: JSON.stringify(openai),
            signal: AbortSignal.timeout(120000),
        })

        if (!r.ok) {
            const errText = await r.text().catch(() => '')
            log.warn({status: r.status, body: errText.slice(0, 300)}, 'upstream error')
            clientRes.writeHead(r.status, {'Content-Type':'application/json'})
            clientRes.end(JSON.stringify({type:'error',error:{type:'api_error',message:`HTTP ${r.status}: ${errText.slice(0, 200)}`}}))
            return
        }

        const respText = await r.text()
        let data
        try { data = JSON.parse(respText) } catch { data = null }
        log.info({status: r.status, hasChoices: !!data?.choices, firstChoice: data?.choices?.[0]?.message?.content?.slice(0,100), error: !!data?.error}, 'upstream ok')
        if (!data || data.error) {
            clientRes.writeHead(r.status||502, {'Content-Type':'application/json'})
            clientRes.end(JSON.stringify({type:'error',error:{type:'api_error',message:data?.error?.message||`Bad response: ${respText.slice(0,200)}`}}))
            return
        }
        clientRes.writeHead(200, {'Content-Type':'application/json'})
        clientRes.end(JSON.stringify(translateResponse(data, body.model)))

    } catch(e) {
        log.error({err: e}, 'proxy error')
        if (!clientRes.headersSent) { clientRes.writeHead(500); clientRes.end(JSON.stringify({error:{message:e.message}})) }
    }
}

// ── 翻译入口 ──
function translateBody(body) {
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
    if (!Array.isArray(m.content)) return {role:'assistant',content:null}
    const texts=[], tcs=[]
    for (const b of m.content) {
        if (b.type==='text') texts.push(b.text)
        else if (b.type==='tool_use') tcs.push({id:b.id,type:'function',function:{name:b.name,arguments:typeof b.input==='string'?b.input:JSON.stringify(b.input)}})
    }
    const r = {role:'assistant'}
    if (texts.length) r.content = texts.join('')
    else if (!tcs.length) r.content = null
    if (tcs.length) r.tool_calls = tcs
    return r
}
function translateResponse(data, model) {
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
function u(usage) { return usage ? {input_tokens:usage.prompt_tokens||0,output_tokens:usage.completion_tokens||0} : {input_tokens:0,output_tokens:0} }
