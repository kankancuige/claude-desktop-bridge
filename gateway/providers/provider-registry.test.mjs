import test from 'node:test'
import assert from 'node:assert/strict'
import {createProviderRegistry} from './provider-registry.mjs'

const ALL_CAPABILITIES = {
    writable: true, resumable: true, modelOverride: true,
    structuredOutput: true, toolFiltering: true, continuation: true,
}

test('Provider 注册、能力校验和启动通过同一边界', () => {
    const calls = []
    const registry = createProviderRegistry()
    registry.register('agent', 'test', {start: (request, requirements) => {
        calls.push({request, requirements})
        return {id: 'handle-1'}
    }}, ALL_CAPABILITIES)

    const handle = registry.start('agent', 'test', {prompt: 'x'}, {writable: true})
    assert.deepEqual(handle, {id: 'handle-1'})
    assert.equal(calls.length, 1)
    assert.throws(() => registry.register('agent', 'test', {start() {}}, ALL_CAPABILITIES), {code: 'PROVIDER_ALREADY_REGISTERED'})
    assert.throws(() => registry.require('agent', 'missing'), {code: 'PROVIDER_NOT_FOUND'})
})

test('缺少能力时不调用 Provider start', () => {
    let started = false
    const registry = createProviderRegistry()
    registry.register('agent', 'readonly', {start: () => { started = true }}, {writable: false})
    assert.throws(() => registry.start('agent', 'readonly', {}, {writable: true}), {code: 'AGENT_CAPABILITY_UNSUPPORTED'})
    assert.equal(started, false)
})

test('注册 disposer 幂等，disposeAll 隔离错误并关闭 Registry', async () => {
    const disposed = []
    const errors = []
    const registry = createProviderRegistry({onDisposeError: (_error, context) => errors.push(context.name)})
    const disposeA = registry.register('agent', 'a', {start() {}, dispose: async () => disposed.push('a')}, ALL_CAPABILITIES)
    registry.register('agent', 'b', {start() {}, dispose: async () => { disposed.push('b'); throw new Error('b failed') }}, ALL_CAPABILITIES)
    assert.equal(await disposeA(), true)
    assert.equal(await disposeA(), false)
    await assert.rejects(registry.disposeAll(), AggregateError)
    assert.deepEqual(disposed, ['a', 'b'])
    assert.deepEqual(errors, ['b'])
    assert.throws(() => registry.require('agent', 'a'), {code: 'PROVIDER_REGISTRY_CLOSED'})
})
