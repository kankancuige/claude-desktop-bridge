import test from 'node:test'
import assert from 'node:assert/strict'
import {createCleanupRegistry} from './cleanup-registry.mjs'

test('父取消按 query、stream、timer、watchdog、listener 顺序清理且只执行一次', async () => {
    const controller = new AbortController()
    const registry = createCleanupRegistry({parentSignal: controller.signal})
    const calls = []
    const disposers = [
        registry.register('listener', () => calls.push('listener')),
        registry.register('watchdog', () => calls.push('watchdog')),
        registry.register('timer', () => calls.push('timer')),
        registry.register('stream', () => calls.push('stream')),
        registry.register('query', () => calls.push('query')),
    ]
    controller.abort('parent-stop')
    await registry.abort('duplicate-stop')
    assert.deepEqual(calls, ['query', 'stream', 'timer', 'watchdog', 'listener'])
    assert.equal(registry.snapshot().state, 'aborted')
    await disposers[0]()
    assert.deepEqual(calls, ['query', 'stream', 'timer', 'watchdog', 'listener'])
})

test('子清理异常转为结构化 failed，不阻断后续资源', async () => {
    const registry = createCleanupRegistry()
    const calls = []
    registry.register('query', () => { calls.push('query'); throw new Error('query-close-failed') })
    registry.register('stream', () => calls.push('stream'))
    const snapshot = await registry.abort('test')
    assert.deepEqual(calls, ['query', 'stream'])
    assert.deepEqual(snapshot.entries.map(entry => entry.status), ['failed', 'cleaned'])
    assert.equal(snapshot.entries[0].error, 'query-close-failed')
})

test('dispose 后注册立即标记 disposed，重复 abort/dispose 幂等', async () => {
    const registry = createCleanupRegistry()
    await registry.dispose('shutdown')
    let called = false
    const unregister = registry.register('timer', () => { called = true })
    await unregister()
    await registry.abort('again')
    await registry.dispose('again')
    assert.equal(called, false)
    assert.equal(registry.snapshot().state, 'disposed')
    assert.equal(registry.snapshot().entries[0].status, 'disposed')
})

test('注册器暴露 AbortSignal，并支持手动注销单个资源', async () => {
    const registry = createCleanupRegistry()
    let count = 0
    const unregister = registry.register(() => { count += 1 }, {kind: 'timer', label: 'manual'})
    await unregister()
    await registry.abort()
    assert.equal(count, 1)
    assert.equal(registry.signal.aborted, true)
})
