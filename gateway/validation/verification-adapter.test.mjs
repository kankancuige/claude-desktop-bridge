import assert from 'node:assert/strict'
import test from 'node:test'
import {createVerificationAdapterRegistry, registerVerificationAdapter} from './verification-adapter.mjs'

test('适配器契约要求受支持类型和 execute', () => {
    assert.throws(() => registerVerificationAdapter({id: 'x', type: 'unknown', execute() {}}))
    assert.throws(() => registerVerificationAdapter({id: 'x', type: 'test'}))
    const registry = createVerificationAdapterRegistry([{id: 'test', type: 'test', execute: async () => ({passed: true})}])
    assert.equal(registry.get('test').type, 'test')
})
