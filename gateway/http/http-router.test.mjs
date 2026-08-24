import test from 'node:test'
import assert from 'node:assert/strict'
import {createHttpRouter} from './http-router.mjs'

test('HTTP Router 按注册顺序停止在第一个已处理路由', async () => {
    const calls = []
    const router = createHttpRouter({
        routes: [
            async () => { calls.push('first'); return false },
            async () => { calls.push('second'); return true },
            async () => { calls.push('third'); return true },
        ],
    })
    assert.equal(await router({}), true)
    assert.deepEqual(calls, ['first', 'second'])
})
test('HTTP Router 将异常交给组合根错误处理器', async () => {
    const error = new Error('route failed')
    const observed = []
    const router = createHttpRouter({
        routes: [async () => { throw error }],
        onError: (caught, context) => { observed.push([caught, context]); return true },
    })
    const context = {requestId: 'r1'}
    assert.equal(await router(context), true)
    assert.equal(observed[0][0], error)
    assert.equal(observed[0][1], context)
})
