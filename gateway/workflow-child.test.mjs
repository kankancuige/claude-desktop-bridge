import test from 'node:test'
import assert from 'node:assert/strict'
import {fork} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const childPath = fileURLToPath(new URL('./workflow-child.mjs', import.meta.url))

function runWorkflowChild(script, {agentResult = {answer: 42}, abortAfterAgentCall = false} = {}) {
    return new Promise((resolve, reject) => {
        const child = fork(childPath, [], {
            silent: true,
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            env: {
                PATH: process.env.PATH || '',
                SystemRoot: process.env.SystemRoot || '',
                WINDIR: process.env.WINDIR || '',
                TEMP: process.env.TEMP || '',
                TMP: process.env.TMP || '',
                NODE_ENV: 'test',
                WORKFLOW_CHILD_SECRET: 'must-not-be-visible',
            },
        })
        let settled = false
        let stderr = ''
        child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })

        const timeout = setTimeout(() => {
            finish(new Error('workflow-child test timeout\n' + stderr))
        }, 8_000)

        function finish(error, message) {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            if (child.exitCode === null) child.kill()
            if (error) reject(error)
            else resolve(message)
        }

        child.on('message', (message) => {
            if (message?.type === 'agent_call') {
                if (abortAfterAgentCall) {
                    child.send({type: 'abort'})
                } else {
                    child.send({type: 'agent_result', callId: message.callId, result: agentResult})
                }
                return
            }
            if (message?.type === 'done' || message?.type === 'error') finish(null, message)
        })
        child.on('error', (error) => finish(error))
        child.on('exit', (code, signal) => {
            if (!settled) finish(new Error(`workflow-child exited before result: code=${code}, signal=${signal}\n${stderr}`))
        })
        child.send({
            type: 'init',
            script,
            args: {target: 'demo'},
            budget: {total: 1234},
            meta: {name: 'test-workflow'},
        })
    })
}

test('受限 context 支持现有 Workflow DSL 并复制 agent 结果', async () => {
    const message = await runWorkflowChild(`
        phase('执行')
        const timerId = setTimeout(() => log('timer'), 1000)
        clearTimeout(timerId)
        const result = await agent('hello', {label: 'demo'})
        return {
            result,
            args,
            budget,
            meta,
            timerType: typeof timerId,
            processType: typeof process,
            requireType: typeof require,
            bufferType: typeof Buffer,
        }
    `)

    assert.equal(message.type, 'done')
    assert.deepEqual(message.result.result, {answer: 42})
    assert.deepEqual(message.result.args, {target: 'demo'})
    assert.deepEqual(message.result.budget, {total: 1234})
    assert.deepEqual(message.result.meta, {name: 'test-workflow'})
    assert.equal(message.result.timerType, 'number')
    assert.equal(message.result.processType, 'undefined')
    assert.equal(message.result.requireType, 'undefined')
    assert.equal(message.result.bufferType, 'undefined')
})

test('环境变量不能通过 globalThis.process 读取', async () => {
    const message = await runWorkflowChild(`
        return {
            direct: globalThis.process,
            secret: globalThis.process?.env?.WORKFLOW_CHILD_SECRET,
        }
    `)
    assert.equal(message.type, 'done')
    assert.deepEqual(message.result, {})
})

test('禁止通过全局构造器生成代码逃逸', async () => {
    const message = await runWorkflowChild(`
        return globalThis.constructor.constructor('return process')()
    `)
    assert.equal(message.type, 'error')
    assert.match(message.message, /Code generation from strings disallowed|not a function|undefined/i)
})

test('禁止通过 agent Promise 构造器生成代码逃逸', async () => {
    const message = await runWorkflowChild(`
        const pending = agent('escape')
        return pending.constructor.constructor('return process')()
    `)
    assert.equal(message.type, 'error')
    assert.match(message.message, /Code generation from strings disallowed|not a function|undefined/i)
})

test('agent 返回对象在 context 内重建，构造器仍不能逃逸', async () => {
    const message = await runWorkflowChild(`
        const result = await agent('escape-result')
        return Object.getPrototypeOf(result).constructor.constructor('return process')()
    `)
    assert.equal(message.type, 'error')
    assert.match(message.message, /Code generation from strings disallowed|not a function|undefined/i)
})

test('动态 import 默认禁用', async () => {
    const message = await runWorkflowChild(`
        return import('node:fs')
    `)
    assert.equal(message.type, 'error')
    assert.match(message.message, /dynamic import|import callback/i)
})

test('父进程 abort 会立即返回 paused 并退出', async () => {
    const message = await runWorkflowChild(`
        await agent('long-running')
        return {finished: true}
    `, {abortAfterAgentCall: true})
    assert.equal(message.type, 'done')
    assert.equal(message.result.paused, true)
    assert.equal(message.result.reason, 'parent_abort')
})
