// workflow-child.mjs — Workflow 子进程沙箱
// 通过 IPC 与父进程通信，无 require/process.env/fs 权限
// agent/parallel/pipeline/staged/phase/log 均为 IPC stub

let aborted = false
let callIdCounter = 0
const pendingCalls = new Map()

process.on('message', async (msg) => {
    switch (msg.type) {
        case 'init':
            await runScript(msg)
            break
        case 'agent_result': {
            const {callId, result, error, code} = msg
            const pending = pendingCalls.get(callId)
            if (pending) {
                pendingCalls.delete(callId)
                if (error) {
                    const err = new Error(error)
                    if (code) err.code = code
                    pending.reject(err)
                } else {
                    pending.resolve(result)
                }
            }
            break
        }
        case 'abort':
            aborted = true
            for (const [, p] of pendingCalls) {
                p.reject(new Error('WorkflowAborted'))
            }
            pendingCalls.clear()
            break
    }
})

// 父进程断开 → 清理退出
process.on('disconnect', () => {
    aborted = true
    for (const [, p] of pendingCalls) {
        p.reject(new Error('WorkflowAborted: 父进程断开'))
    }
    pendingCalls.clear()
    process.exit(0)
})

async function runScript(init) {
    const {script, args: extraArgs, budget: initBudget, meta} = init

    const budget = {total: initBudget?.total || null}
    const args = {...(extraArgs || {})}

    // ── IPC stub: phase ──
    const phase = (title) => {
        process.send({type: 'phase', title})
    }

    // ── IPC stub: log ──
    const sandboxLog = (msg) => {
        process.send({type: 'log', msg: String(msg)})
    }

    // ── IPC stub: agent ──
    const agent = (prompt, opts = {}) => {
        if (aborted) return Promise.reject(new Error('WorkflowAborted'))
        return new Promise((resolve, reject) => {
            const callId = String(++callIdCounter)
            pendingCalls.set(callId, {resolve, reject})
            process.send({type: 'agent_call', callId, prompt, opts})
        })
    }

    // ── parallel (编排在子进程) ──
    const MAX_CONCURRENT = 20
    const parallel = async (thunks) => {
        if (!Array.isArray(thunks) || thunks.length === 0) return []
        sandboxLog('[Parallel] ' + thunks.length + ' 个任务')
        const results = []
        for (let i = 0; i < thunks.length; i += MAX_CONCURRENT) {
            if (aborted) throw new Error('WorkflowAborted')
            const batch = thunks.slice(i, i + MAX_CONCURRENT)
            const batchResults = await Promise.all(batch.map(fn =>
                fn().catch(e => {
                    if (e.code === 'BUDGET_EXCEEDED') throw e
                    sandboxLog('[Parallel] 异常: ' + e.message)
                    return null
                })
            ))
            results.push(...batchResults)
        }
        sandboxLog('[Parallel] 完成: ' + results.filter(Boolean).length + '/' + thunks.length)
        return results
    }

    // ── pipeline (编排在子进程) ──
    // 流式管道: 各 item 独立流经 stage, 无阶段间屏障
    const pipeline = async (items, ...stages) => {
        if (!Array.isArray(items) || items.length === 0) return []
        if (stages.length === 0) return items
        sandboxLog('[Pipeline] ' + items.length + ' 项 x ' + stages.length + ' 阶段')
        const results = new Array(items.length)
        await Promise.all(items.map(async (item, idx) => {
            try {
                let val = item
                for (let si = 0; si < stages.length; si++) {
                    if (aborted) throw new Error('WorkflowAborted')
                    try {
                        val = await stages[si](val, item, idx)
                    } catch (stageErr) {
                        if (stageErr.code === 'BUDGET_EXCEEDED') throw stageErr
                        sandboxLog('[Pipeline 项' + idx + ' 阶段' + si + '] 异常: ' + stageErr.message)
                        val = null; break
                    }
                }
                results[idx] = val
            } catch (e) {
                if (e.code === 'BUDGET_EXCEEDED') throw e
                sandboxLog('[Pipeline 项' + idx + '] 异常: ' + e.message)
                results[idx] = null
            }
        }))
        return results
    }

    // ── staged (编排在子进程) ──
    // 屏障式管道: 所有 item 完成当前 stage 后才进入下一 stage
    const staged = async (items, ...stages) => {
        if (!Array.isArray(items) || items.length === 0) return []
        if (stages.length === 0) return items
        sandboxLog('[Staged] ' + items.length + ' 项 x ' + stages.length + ' 阶段（屏障模式）')
        let current = [...items]
        for (let si = 0; si < stages.length; si++) {
            if (aborted) throw new Error('WorkflowAborted')
            sandboxLog('[Staged] 阶段 ' + (si + 1) + '/' + stages.length)
            const stageResults = await Promise.all(current.map(async (item, idx) => {
                try {
                    return await stages[si](item, current[idx], idx)
                } catch (e) {
                    if (e.code === 'BUDGET_EXCEEDED') throw e
                    sandboxLog('[Staged 项' + idx + ' 阶段' + si + '] 异常: ' + e.message)
                    return null
                }
            }))
            current = stageResults
        }
        sandboxLog('[Staged] 完成')
        return current
    }

    // ── 受控 setTimeout / clearTimeout ──
    const MAX_PENDING_TIMERS = 10
    const _pendingTimers = new Set()
    const safeSetTimeout = (fn, delay) => {
        if (typeof delay !== 'number' || delay < 0) delay = 0
        if (_pendingTimers.size >= MAX_PENDING_TIMERS) {
            sandboxLog('[Warn] setTimeout 已达上限(' + MAX_PENDING_TIMERS + ')，调用被忽略')
            return -1
        }
        const id = setTimeout(() => {
            _pendingTimers.delete(id)
            try { fn() } catch (e) { sandboxLog('[Error] setTimeout 回调异常: ' + e.message) }
        }, Math.min(delay, 30000))
        _pendingTimers.add(id)
        return id
    }
    const safeClearTimeout = (id) => {
        if (id === undefined || id === null) return
        clearTimeout(id)
        _pendingTimers.delete(id)
    }

    // ── 解析并执行脚本 ──
    let scriptBody = script
    const metaKeyIdx = scriptBody.indexOf('export const meta = {')
    if (metaKeyIdx !== -1) {
        // 括号计数找 meta 块的结束位置
        let depth = 0, inStr = false, ch = ''
        const openIdx = metaKeyIdx + 21
        let closeIdx = -1
        for (let i = openIdx; i < scriptBody.length; i++) {
            const c = scriptBody[i]
            if (inStr) {
                if (c === '\\') { i++; continue }
                if (c === ch) inStr = false
                continue
            }
            if (c === '"' || c === "'") { inStr = true; ch = c; continue }
            if (c === '{') depth++
            else if (c === '}') { if (--depth === 0) { closeIdx = i; break } }
        }
        if (closeIdx !== -1) {
            let end = closeIdx + 1
            while (end < scriptBody.length && (scriptBody[end] === ';' || scriptBody[end] === '\n' || scriptBody[end] === '\r')) end++
            scriptBody = scriptBody.substring(0, metaKeyIdx) + scriptBody.substring(end)
        }
    }
    scriptBody = scriptBody.replace(/export\s+/g, '')

    const wrappedScript = `
    (async () => {
      try { ${scriptBody} }
      catch (_wfError) {
        if (_wfError.code === 'BUDGET_EXCEEDED') {
          console.warn('Budget 已用尽: ' + _wfError.message);
          throw _wfError;
        }
        console.error('Workflow script error: ' + (_wfError?.message || _wfError));
        throw _wfError;
      }
    })()
  `

    try {
        const fn = new Function(
            'agent', 'parallel', 'pipeline', 'staged', 'phase', 'log', 'budget', 'args', 'meta',
            'console', 'setTimeout', 'clearTimeout',
            'Promise', 'JSON', 'Array', 'Object', 'String', 'Number', 'Boolean',
            'Math', 'Date', 'Error', 'RegExp', 'Map', 'Set',
            'parseInt', 'parseFloat', 'isNaN', 'isFinite',
            'encodeURIComponent', 'decodeURIComponent',
            wrappedScript
        )
        const result = await fn(
            agent, parallel, pipeline, staged,
            phase, sandboxLog, budget, args, meta,
            {
                log: (...a) => sandboxLog(a.map(String).join(' ')),
                error: (...a) => sandboxLog('[Error] ' + a.map(String).join(' ')),
                warn: (...a) => sandboxLog('[Warn] ' + a.map(String).join(' ')),
            },
            safeSetTimeout, safeClearTimeout,
            Promise, JSON, Array, Object, String, Number, Boolean,
            Math, Date, Error, RegExp, Map, Set,
            parseInt, parseFloat, isNaN, isFinite,
            encodeURIComponent, decodeURIComponent
        )
        process.send({type: 'done', result})
    } catch (e) {
        if (aborted || e.message?.includes('WorkflowAborted')) {
            process.send({type: 'done', result: {paused: true}})
        } else {
            process.send({type: 'error', message: e.message, code: e.code})
        }
    }
}
