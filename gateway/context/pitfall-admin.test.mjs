import assert from 'node:assert/strict'
import test from 'node:test'
import {createPitfallAdmin} from './pitfall-admin.mjs'

test('管理入口只转发显式状态操作', () => {
    const calls = []
    const admin = createPitfallAdmin({pitfallService: {
        list: () => [],
        transitionPitfall: (...args) => { calls.push(args); return true },
        verifyPitfallPrevention: (...args) => { calls.push(args); return true },
    }})
    assert.deepEqual(admin.list({projectKey: 'p'}), [])
    admin.confirm('1', {rootCause: 'x'})
    admin.ignore('2')
    admin.verify('3', 'e')
    assert.deepEqual(calls.map(call => call[0]), ['1', '2', '3'])
})
