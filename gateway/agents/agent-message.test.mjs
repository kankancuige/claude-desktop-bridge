import assert from 'node:assert/strict'
import test from 'node:test'
import {createAgentMailbox} from './agent-message.mjs'

test('Mailbox 消息幂等、结构化且通过事件触发唤醒', () => {
    let now = 1000
    const wakes = []
    const mailbox = createAgentMailbox({now: () => now, maxHops: 2, onWake: event => wakes.push(event)})
    const input = {messageId: 'm1', taskId: 't1', fromAgent: 'planner', toAgent: 'builder', type: 'result', summary: '计划已完成', references: [{type: 'task', key: 't1:step:1'}]}
    assert.equal(mailbox.send(input).accepted, true)
    assert.equal(mailbox.send(input).duplicate, true)
    assert.equal(wakes.length, 1)
    assert.equal(mailbox.list({toAgent: 'builder'})[0].summary, '计划已完成')
    assert.equal('prompt' in mailbox.list()[0], false)
    assert.equal(mailbox.ack('m1', {status: 'consumed'}), true)
    assert.equal(mailbox.list({status: 'pending'}).length, 0)
})

test('Mailbox claim 在 Agent 失败时可恢复为 pending，in-flight 过期可清理', () => {
    let now = 1000
    const mailbox = createAgentMailbox({now: () => now, maxAgeMs: 1000})
    mailbox.send({messageId: 'retry', taskId: 't', fromAgent: 'a', toAgent: 'b', summary: '重试'})
    assert.equal(mailbox.consume({toAgent: 'b'})[0].status, 'in_flight')
    assert.equal(mailbox.list({status: 'pending'}).length, 0)
    assert.equal(mailbox.ack('retry', {status: 'pending'}), true)
    assert.equal(mailbox.list({status: 'pending'}).length, 1)
    mailbox.consume({toAgent: 'b'})
    now = 2501
    assert.equal(mailbox.expire(), 1)
    assert.equal(mailbox.get('retry').status, 'expired')
})

test('Mailbox 拒绝超 Hop、无界消息和过期消息', () => {
    let now = 1000
    const mailbox = createAgentMailbox({now: () => now, maxHops: 1, maxAgeMs: 1000, maxMessages: 1})
    assert.equal(mailbox.send({messageId: 'bad-hop', taskId: 't', fromAgent: 'a', toAgent: 'b', summary: 'x', hop: 2}).reason, 'max_message_hops')
    assert.equal(mailbox.send({messageId: 'ok', taskId: 't', fromAgent: 'a', toAgent: 'b', summary: 'x'}).accepted, true)
    assert.equal(mailbox.send({messageId: 'full', taskId: 't', fromAgent: 'a', toAgent: 'b', summary: 'x'}).reason, 'mailbox_full')
    now = 3001
    assert.equal(mailbox.list().length, 0)
    assert.equal(mailbox.expire(), 1)
    assert.equal(mailbox.get('ok').status, 'expired')
})
