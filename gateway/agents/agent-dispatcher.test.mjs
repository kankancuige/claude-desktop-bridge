import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import test from 'node:test'
import {createAgentDispatcher} from './agent-dispatcher.mjs'
import {createAgentRegistry} from './agent-registry.mjs'

const base = {taskId: 't', stepId: 's', role: 'developer', goal: '改代码', workDir: resolve('.'), targetFiles: ['a.mjs'], modelTier: 'balanced', permissionMode: 'acceptEdits'}

test('缺失身份、能力不支持和越权修改均显式拒绝', async () => {
    const registry = createAgentRegistry()
    const dispatcher = createAgentDispatcher({registry, execute: async () => ({status: 'completed', changedFiles: ['b.mjs']})})
    await assert.rejects(dispatcher.dispatchAgent({...base, taskId: ''}), error => error?.code === 'INVALID_AGENT_INPUT')
    await assert.rejects(dispatcher.dispatchAgent({...base, requirements: {structuredOutput: true}}), error => error?.code === 'AGENT_CAPABILITY_UNSUPPORTED')
    await assert.rejects(dispatcher.dispatchAgent(base), error => error?.code === 'AGENT_SCOPE_VIOLATION')
})

test('只读 Agent 即使文件位于项目内也不能声明修改', async () => {
    const registry = createAgentRegistry()
    const dispatcher = createAgentDispatcher({
        registry,
        execute: async () => ({status: 'completed', summary: '错误声明', changedFiles: ['inside.mjs']}),
    })
    await assert.rejects(dispatcher.dispatchAgent({
        agentId: 'reviewer', taskId: 't', stepId: 's', role: 'reviewer', goal: '审查',
        workDir: resolve('.'), targetFiles: ['inside.mjs'], modelTier: 'balanced', permissionMode: 'plan',
    }), error => error?.code === 'AGENT_SCOPE_VIOLATION')
})

test('合法结构化结果发出统一生命周期事件', async () => {
    const events = []
    const dispatcher = createAgentDispatcher({
        registry: createAgentRegistry(),
        publish: event => events.push(event.type),
        execute: async () => ({status: 'completed', summary: '完成', changedFiles: ['a.mjs'], tests: [{name: 'test', status: 'passed', executed: true}]}),
    })
    const result = await dispatcher.dispatchAgent(base)
    assert.equal(result.status, 'completed')
    assert.deepEqual(events, ['agent/started', 'agent/completed'])
})

test('Agent 运行只消费一次有界 Mailbox 消息，不产生轮询', async () => {
    const consumed = []
    const mailbox = {consume: options => { consumed.push(options); return [{messageId: 'm1', summary: '继续验证'}]}}
    let received = null
    const dispatcher = createAgentDispatcher({
        registry: createAgentRegistry(), mailbox,
        execute: async input => { received = input.mailboxMessages; return {status: 'completed', summary: '完成'} },
    })
    await dispatcher.dispatchAgent(base)
    assert.deepEqual(received, [{messageId: 'm1', summary: '继续验证'}])
    assert.deepEqual(consumed, [{toAgent: 'developer', taskId: 't', limit: 20}])
})

test('Agent 执行失败时不丢失已 claim 的 Mailbox 消息', async () => {
    const states = []
    const mailbox = {
        consume: () => [{messageId: 'm1', summary: '继续'}],
        ack: (id, value) => states.push([id, value.status]),
    }
    const dispatcher = createAgentDispatcher({registry: createAgentRegistry(), mailbox, execute: async () => { throw new Error('provider down') }})
    await assert.rejects(() => dispatcher.dispatchAgent(base), /provider down/)
    assert.deepEqual(states, [['m1', 'pending']])
})
