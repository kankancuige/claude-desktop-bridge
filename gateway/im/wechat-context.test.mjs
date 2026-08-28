import assert from 'node:assert/strict'
import test from 'node:test'
import {rememberWeChatContext, resolveWeChatContext} from './wechat-context.mjs'

test('主动发送复用用户最近一次入站 context token', () => {
    const contexts = new Map()
    assert.equal(rememberWeChatContext(contexts, 'user-1', 'ctx-1'), true)
    assert.equal(resolveWeChatContext(contexts, 'user-1', ''), 'ctx-1')
    assert.equal(resolveWeChatContext(contexts, 'user-1', 'ctx-2'), 'ctx-2')
})

test('空值和超长 token 不进入缓存', () => {
    const contexts = new Map()
    assert.equal(rememberWeChatContext(contexts, 'user-1', ''), false)
    assert.equal(rememberWeChatContext(contexts, 'user-1', 'x'.repeat(4097)), false)
    assert.equal(resolveWeChatContext(contexts, 'user-1', ''), '')
})

