import assert from 'node:assert/strict'
import test from 'node:test'
import {PushStream} from './push-stream.mjs'

test('PushStream 按 FIFO 迭代已入队消息', async () => {
    const stream = new PushStream()
    stream.push({id: 1})
    stream.push({id: 2})
    const iterator = stream[Symbol.asyncIterator]()
    assert.deepEqual(await iterator.next(), {value: {id: 1}, done: false})
    assert.deepEqual(await iterator.next(), {value: {id: 2}, done: false})
})

test('等待中的 next 被 push 唤醒，close 后停止', async () => {
    const stream = new PushStream()
    const iterator = stream[Symbol.asyncIterator]()
    const pending = iterator.next()
    assert.equal(stream.push('message'), true)
    assert.deepEqual(await pending, {value: 'message', done: false})
    assert.equal(stream.close(), true)
    assert.equal(stream.push('ignored'), false)
    assert.deepEqual(await iterator.next(), {value: undefined, done: true})
    assert.equal(stream.close(), false)
})
