// workflow-child.mjs - Workflow 子进程执行边界
// Workflow 仅面向可信本地脚本；独立进程和受限 VM context 用于降低误操作影响，不是 OS 级安全沙箱。
import {createContext, runInContext} from 'node:vm'

const MAX_SCRIPT_BYTES = 1024 * 1024
const MAX_AGENT_PROMPT_BYTES = 1024 * 1024
const MAX_AGENT_OPTIONS_BYTES = 256 * 1024
const MAX_IPC_PAYLOAD_BYTES = 5 * 1024 * 1024
const MAX_PENDING_AGENT_CALLS = 32
const MAX_PENDING_TIMERS = 10
const MAX_TIMER_DELAY_MS = 30_000
const SYNC_EXECUTION_TIMEOUT_MS = 5_000

let aborted = false
let running = false
let finalized = false
let callIdCounter = 0
let timerIdCounter = 0
const pendingCalls = new Map()
const pendingTimers = new Map()

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error)
}

function byteLength(value) {
    return Buffer.byteLength(value, 'utf8')
}

function safeSend(message, callback) {
    if (!process.connected || typeof process.send !== 'function') return false
    try {
        process.send(message, (error) => {
            if (error && !finalized) {
                process.stderr.write('[workflow-child] IPC 发送失败: ' + errorMessage(error) + '\n')
            }
            callback?.(error)
        })
        return true
    } catch (error) {
        if (!finalized) {
            process.stderr.write('[workflow-child] IPC 发送异常: ' + errorMessage(error) + '\n')
        }
        callback?.(error)
        return false
    }
}

function clearAllTimers() {
    for (const timeout of pendingTimers.values()) clearTimeout(timeout)
    pendingTimers.clear()
}

function rejectPendingCalls(message) {
    for (const pending of pendingCalls.values()) {
        const error = new Error(message)
        error.code = 'WORKFLOW_ABORTED'
        pending.reject(error)
    }
    pendingCalls.clear()
}

function finish(message, exitAfterSend = false) {
    if (finalized) return
    finalized = true
    clearAllTimers()
    rejectPendingCalls('WorkflowAborted')
    const sent = safeSend(message, () => {
        if (exitAfterSend) process.exit(0)
    })
    if (exitAfterSend && !sent) process.exit(0)
}

function abortWorkflow(reason) {
    if (finalized) return
    aborted = true
    finish({type: 'done', result: {paused: true, reason}}, true)
}

process.on('message', (message) => {
    if (!message || typeof message !== 'object' || finalized) return

    switch (message.type) {
        case 'init':
            if (running) {
                finish({type: 'error', message: 'Workflow 子进程重复初始化', code: 'WORKFLOW_ALREADY_RUNNING'}, true)
                return
            }
            running = true
            void runScript(message)
            break

        case 'agent_result': {
            const callId = String(message.callId ?? '')
            const pending = pendingCalls.get(callId)
            if (!pending) return
            pendingCalls.delete(callId)
            if (message.error) {
                const error = new Error(String(message.error))
                if (message.code) error.code = String(message.code)
                pending.reject(error)
            } else {
                pending.resolve(message.result)
            }
            break
        }

        case 'abort':
            abortWorkflow('parent_abort')
            break
    }
})

process.on('disconnect', () => {
    aborted = true
    clearAllTimers()
    rejectPendingCalls('WorkflowAborted: 父进程断开')
    process.exit(0)
})

process.on('uncaughtException', (error) => {
    finish({type: 'error', message: errorMessage(error), code: 'WORKFLOW_CHILD_CRASH'}, true)
})

process.on('unhandledRejection', (error) => {
    finish({type: 'error', message: errorMessage(error), code: 'WORKFLOW_UNHANDLED_REJECTION'}, true)
})

function serializeEnvelope(value) {
    let payload
    try {
        payload = JSON.stringify({ok: true, value})
    } catch (error) {
        return JSON.stringify({ok: false, error: '结果无法序列化: ' + errorMessage(error), code: 'WORKFLOW_RESULT_SERIALIZATION_FAILED'})
    }
    if (byteLength(payload) > MAX_IPC_PAYLOAD_BYTES) {
        return JSON.stringify({ok: false, error: '结果超过 5MB 限制', code: 'WORKFLOW_RESULT_TOO_LARGE'})
    }
    return payload
}

function serializeErrorEnvelope(error) {
    return JSON.stringify({
        ok: false,
        error: errorMessage(error),
        code: typeof error?.code === 'string' ? error.code : undefined,
    })
}

function stripWorkflowExports(source) {
    let scriptBody = source
    const metaMatch = /export\s+const\s+meta\s*=\s*\{/.exec(scriptBody)
    if (metaMatch) {
        let depth = 0
        let quote = ''
        let closeIndex = -1
        const openIndex = scriptBody.indexOf('{', metaMatch.index)
        for (let index = openIndex; index < scriptBody.length; index++) {
            const char = scriptBody[index]
            if (quote) {
                if (char === '\\') index++
                else if (char === quote) quote = ''
                continue
            }
            if (char === '"' || char === "'" || char === '`') {
                quote = char
                continue
            }
            if (char === '{') depth++
            else if (char === '}' && --depth === 0) {
                closeIndex = index
                break
            }
        }
        if (closeIndex >= 0) {
            let end = closeIndex + 1
            while (end < scriptBody.length && /[;\r\n]/.test(scriptBody[end])) end++
            scriptBody = scriptBody.slice(0, metaMatch.index) + scriptBody.slice(end)
        }
    }
    return scriptBody.replace(/^\s*export\s+/gm, '')
}

function createHostBridge() {
    const bridge = Object.create(null)

    Object.defineProperties(bridge, {
        agent: {
            value: async (requestJson) => {
                try {
                    if (aborted) throw Object.assign(new Error('WorkflowAborted'), {code: 'WORKFLOW_ABORTED'})
                    if (pendingCalls.size >= MAX_PENDING_AGENT_CALLS) {
                        throw Object.assign(new Error('并发 agent 调用超过上限 ' + MAX_PENDING_AGENT_CALLS), {code: 'WORKFLOW_AGENT_LIMIT'})
                    }
                    if (typeof requestJson !== 'string' || byteLength(requestJson) > MAX_AGENT_PROMPT_BYTES + MAX_AGENT_OPTIONS_BYTES) {
                        throw Object.assign(new Error('agent 请求超过大小限制'), {code: 'WORKFLOW_AGENT_REQUEST_TOO_LARGE'})
                    }
                    const request = JSON.parse(requestJson)
                    if (typeof request.prompt !== 'string' || byteLength(request.prompt) > MAX_AGENT_PROMPT_BYTES) {
                        throw Object.assign(new Error('agent prompt 必须是 1MB 以内的字符串'), {code: 'WORKFLOW_INVALID_AGENT_PROMPT'})
                    }
                    if (!request.opts || typeof request.opts !== 'object' || Array.isArray(request.opts)) {
                        throw Object.assign(new Error('agent opts 必须是对象'), {code: 'WORKFLOW_INVALID_AGENT_OPTIONS'})
                    }
                    const optionsJson = JSON.stringify(request.opts)
                    if (byteLength(optionsJson) > MAX_AGENT_OPTIONS_BYTES) {
                        throw Object.assign(new Error('agent opts 超过 256KB 限制'), {code: 'WORKFLOW_INVALID_AGENT_OPTIONS'})
                    }

                    const result = await new Promise((resolve, reject) => {
                        const callId = String(++callIdCounter)
                        pendingCalls.set(callId, {resolve, reject})
                        if (!safeSend({type: 'agent_call', callId, prompt: request.prompt, opts: request.opts})) {
                            pendingCalls.delete(callId)
                            reject(Object.assign(new Error('父进程 IPC 已断开'), {code: 'WORKFLOW_IPC_CLOSED'}))
                        }
                    })
                    return serializeEnvelope(result)
                } catch (error) {
                    return serializeErrorEnvelope(error)
                }
            },
            enumerable: true,
        },
        phase: {
            value: (title) => {
                if (!aborted) safeSend({type: 'phase', title: String(title).slice(0, 500)})
            },
            enumerable: true,
        },
        log: {
            value: (message) => {
                if (!aborted) safeSend({type: 'log', msg: String(message).slice(0, 16_384)})
            },
            enumerable: true,
        },
        setTimer: {
            value: (callback, delay) => {
                if (aborted || typeof callback !== 'function') return -1
                if (pendingTimers.size >= MAX_PENDING_TIMERS) return -1
                const numericDelay = Number(delay)
                const boundedDelay = Number.isFinite(numericDelay)
                    ? Math.max(0, Math.min(numericDelay, MAX_TIMER_DELAY_MS))
                    : 0
                const timerId = ++timerIdCounter
                const timeout = setTimeout(() => {
                    pendingTimers.delete(timerId)
                    if (aborted || finalized) return
                    try {
                        const callbackResult = callback()
                        Promise.resolve(callbackResult).catch((error) => {
                            if (!finalized) safeSend({type: 'log', msg: '[Error] setTimeout 回调异常: ' + errorMessage(error)})
                        })
                    } catch (error) {
                        safeSend({type: 'log', msg: '[Error] setTimeout 回调异常: ' + errorMessage(error)})
                    }
                }, boundedDelay)
                timeout.unref?.()
                pendingTimers.set(timerId, timeout)
                return timerId
            },
            enumerable: true,
        },
        clearTimer: {
            value: (timerId) => {
                const timeout = pendingTimers.get(Number(timerId))
                if (!timeout) return
                clearTimeout(timeout)
                pendingTimers.delete(Number(timerId))
            },
            enumerable: true,
        },
    })

    return Object.freeze(bridge)
}

function createSandboxContext(seed) {
    const sandbox = Object.create(null)
    const context = createContext(sandbox, {
        name: 'claude-desktop-bridge-workflow',
        codeGeneration: {strings: false, wasm: false},
    })
    Object.defineProperty(sandbox, '__bridge', {
        value: createHostBridge(),
        configurable: true,
        enumerable: false,
        writable: false,
    })

    const seedJson = JSON.stringify(seed)
    runInContext(`
        (() => {
            'use strict'
            const bridge = globalThis.__bridge
            const seed = JSON.parse(${JSON.stringify(seedJson)})
            const decode = (payload) => {
                const envelope = JSON.parse(payload)
                if (envelope.ok) return envelope.value
                const error = new Error(envelope.error || 'Workflow agent 调用失败')
                if (envelope.code) error.code = envelope.code
                throw error
            }
            const harden = (fn) => {
                Object.setPrototypeOf(fn, null)
                return Object.freeze(fn)
            }
            const logValue = (prefix, values) => {
                bridge.log(prefix + values.map((value) => {
                    if (typeof value === 'string') return value
                    try { return JSON.stringify(value) }
                    catch (_error) { return String(value) }
                }).join(' '))
            }

            const agent = harden(async (prompt, opts = {}) => {
                const request = JSON.stringify({prompt, opts})
                return decode(await bridge.agent(request))
            })
            const phase = harden((title) => bridge.phase(title))
            const log = harden((message) => bridge.log(message))
            const setTimeout = harden((callback, delay) => bridge.setTimer(callback, delay))
            const clearTimeout = harden((timerId) => bridge.clearTimer(timerId))
            const parallel = harden(async (thunks) => {
                if (!Array.isArray(thunks) || thunks.length === 0) return []
                bridge.log('[Parallel] ' + thunks.length + ' 个任务')
                const results = []
                for (let index = 0; index < thunks.length; index += 16) {
                    const batch = thunks.slice(index, index + 16)
                    const batchResults = await Promise.all(batch.map(async (thunk) => {
                        if (typeof thunk !== 'function') return null
                        try { return await thunk() }
                        catch (error) {
                            if (error?.code === 'BUDGET_EXCEEDED' || error?.code === 'WORKFLOW_ABORTED') throw error
                            bridge.log('[Parallel] 异常: ' + (error?.message || String(error)))
                            return null
                        }
                    }))
                    results.push(...batchResults)
                }
                bridge.log('[Parallel] 完成: ' + results.filter((value) => value != null).length + '/' + thunks.length)
                return results
            })
            const pipeline = harden(async (items, ...stages) => {
                if (!Array.isArray(items) || items.length === 0) return []
                if (stages.length === 0) return [...items]
                bridge.log('[Pipeline] ' + items.length + ' 项 x ' + stages.length + ' 阶段')
                return Promise.all(items.map(async (originalItem, itemIndex) => {
                    let value = originalItem
                    for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
                        try { value = await stages[stageIndex](value, originalItem, itemIndex) }
                        catch (error) {
                            if (error?.code === 'BUDGET_EXCEEDED' || error?.code === 'WORKFLOW_ABORTED') throw error
                            bridge.log('[Pipeline 项' + itemIndex + ' 阶段' + stageIndex + '] 异常: ' + (error?.message || String(error)))
                            return null
                        }
                    }
                    return value
                }))
            })
            const staged = harden(async (items, ...stages) => {
                if (!Array.isArray(items) || items.length === 0) return []
                let current = [...items]
                for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
                    bridge.log('[Staged] 阶段 ' + (stageIndex + 1) + '/' + stages.length)
                    current = await Promise.all(current.map(async (item, itemIndex) => {
                        try { return await stages[stageIndex](item, item, itemIndex) }
                        catch (error) {
                            if (error?.code === 'BUDGET_EXCEEDED' || error?.code === 'WORKFLOW_ABORTED') throw error
                            bridge.log('[Staged 项' + itemIndex + ' 阶段' + stageIndex + '] 异常: ' + (error?.message || String(error)))
                            return null
                        }
                    }))
                }
                return current
            })
            const console = Object.freeze(Object.assign(Object.create(null), {
                log: harden((...values) => logValue('', values)),
                error: harden((...values) => logValue('[Error] ', values)),
                warn: harden((...values) => logValue('[Warn] ', values)),
            }))

            Object.defineProperties(globalThis, {
                agent: {value: agent, enumerable: true},
                parallel: {value: parallel, enumerable: true},
                pipeline: {value: pipeline, enumerable: true},
                staged: {value: staged, enumerable: true},
                phase: {value: phase, enumerable: true},
                log: {value: log, enumerable: true},
                budget: {value: seed.budget, enumerable: true},
                args: {value: seed.args, enumerable: true},
                meta: {value: seed.meta, enumerable: true},
                console: {value: console},
                setTimeout: {value: setTimeout},
                clearTimeout: {value: clearTimeout},
                process: {value: undefined},
                require: {value: undefined},
                Buffer: {value: undefined},
                eval: {value: undefined},
                Function: {value: undefined},
                WebAssembly: {value: undefined},
                SharedArrayBuffer: {value: undefined},
                Atomics: {value: undefined},
            })
            delete globalThis.__bridge
        })()
    `, context, {timeout: SYNC_EXECUTION_TIMEOUT_MS, displayErrors: true})

    return context
}

async function runScript(init) {
    try {
        if (typeof init.script !== 'string' || byteLength(init.script) > MAX_SCRIPT_BYTES) {
            throw Object.assign(new Error('Workflow 脚本必须是 1MB 以内的字符串'), {code: 'WORKFLOW_INVALID_SCRIPT'})
        }

        const context = createSandboxContext({
            budget: {total: init.budget?.total ?? null},
            args: init.args && typeof init.args === 'object' ? init.args : {},
            meta: init.meta && typeof init.meta === 'object' ? init.meta : null,
        })
        const scriptBody = stripWorkflowExports(init.script)
        const wrappedScript = `
            (async () => {
                try {
                    const value = await (async () => { ${scriptBody}\n })()
                    return JSON.stringify({ok: true, value})
                } catch (error) {
                    return JSON.stringify({
                        ok: false,
                        error: error?.message || String(error),
                        code: typeof error?.code === 'string' ? error.code : undefined,
                    })
                }
            })()
        `
        const resultEnvelopeJson = await runInContext(wrappedScript, context, {
            timeout: SYNC_EXECUTION_TIMEOUT_MS,
            displayErrors: true,
        })
        if (aborted || finalized) return

        if (typeof resultEnvelopeJson !== 'string' || byteLength(resultEnvelopeJson) > MAX_IPC_PAYLOAD_BYTES) {
            throw Object.assign(new Error('Workflow 结果无效或超过 5MB 限制'), {code: 'WORKFLOW_RESULT_TOO_LARGE'})
        }
        const envelope = JSON.parse(resultEnvelopeJson)
        if (!envelope.ok) {
            finish({type: 'error', message: String(envelope.error || 'Workflow 执行失败'), code: envelope.code})
            return
        }
        if (pendingCalls.size > 0) {
            throw Object.assign(new Error('Workflow 返回时仍有未等待的 agent 调用'), {code: 'WORKFLOW_UNAWAITED_AGENT'})
        }
        finish({type: 'done', result: envelope.value})
    } catch (error) {
        if (aborted || finalized) return
        finish({type: 'error', message: errorMessage(error), code: error?.code})
    }
}
