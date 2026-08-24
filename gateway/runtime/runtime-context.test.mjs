import assert from 'node:assert/strict'
import test from 'node:test'
import {assertRuntimePort, createRuntimeContext} from './runtime-context.mjs'

test('Runtime Context 按领域冻结命名端口', () => {
    const context = createRuntimeContext({session: {get() { return null }}, storage: {health() { return null }}})
    assert.equal(typeof context.session.get, 'function')
    assert.equal(Object.isFrozen(context), true)
    assert.equal(Object.isFrozen(context.session), true)
})

test('Runtime Context 拒绝标量端口和缺失方法', () => {
    assert.throws(() => createRuntimeContext({session: 1}), /must be an object/)
    assert.throws(() => assertRuntimePort({}, ['get']), /method get is required/)
})
