import test from 'node:test'
import assert from 'node:assert/strict'

import {createSessionRuntime, createSessionContextEnvelope} from './session-runtime.mjs'

test('所有 Session 类型共享队列、资源、父任务和生命周期不变量', () => {
    const runtime = createSessionRuntime({workDir: 'D:/project', opts: {permissionMode: 'plan'}})
    assert.equal(runtime.permissionMode, 'plan')
    assert.ok(runtime.clients instanceof Set)
    assert.ok(runtime.pending instanceof Map)
    assert.ok(runtime.children instanceof Set)
    assert.ok(runtime._inputIds instanceof Map)
    assert.deepEqual(runtime._pendingInputs, [])
    assert.equal(runtime.taskCompletion.phase, 'idle')
    assert.equal(runtime.taskState.status, 'idle')
    assert.equal(runtime._taskWorkflowGate.active.size, 0)
    assert.equal(runtime.autoContinuationCount, 0)
    assert.equal(runtime.autoContinuationTurns, 0)
    assert.equal(runtime._autoContinuationRequest, null)
    assert.equal(runtime.contextEnvelope.resumeMode, 'unavailable')
})

test('恢复身份和 Session 类型特有字段由同一工厂叠加', () => {
    const runtime = createSessionRuntime({
        workDir: 'D:/project', identity: 'sdk-old', agentName: 'scheduler',
        extra: {_autoDelete: true},
    })
    assert.equal(runtime.lastSessionId, 'sdk-old')
    assert.equal(runtime.hasUserTurns, true)
    assert.equal(runtime.agentName, 'scheduler')
    assert.equal(runtime._autoDelete, true)
})

test('运行态上下文 envelope 不保存 Provider 地址、凭据或工作目录', () => {
    const runtime = createSessionRuntime({
        workDir: 'D:/private-project', identity: 'sdk-old',
        opts: {
            model: 'model-balanced', permissionMode: 'default',
            bridgeProviderBaseUrl: 'https://relay.example.test/private',
            bridgeProviderApiKey: 'secret-token', bridgeContextProfile: 'full',
        },
    })
    const rebuilt = createSessionContextEnvelope(runtime)
    const serialized = JSON.stringify(rebuilt)
    assert.equal(rebuilt.resumeMode, 'available')
    assert.doesNotMatch(serialized, /relay\.example|private-project|secret-token/i)
})

test('Session Runtime 为 query、stream 和 watchdog 建立统一 Cleanup Registry', async () => {
    const runtime = createSessionRuntime({workDir: 'D:/project'})
    assert.ok(runtime.cleanupRegistry)
    assert.equal(runtime.cleanupRegistry.signal.aborted, false)
    const first = runtime.cleanupRegistry
    const replacement = runtime.newCleanupRegistry()
    assert.notEqual(replacement, first)
    assert.equal(first.snapshot().state, 'active')
    await replacement.abort('test')
    assert.equal(replacement.snapshot().state, 'aborted')
})

test('Session Runtime 清理优先关闭 SDK Query，并取消本次 Query 的 AbortController', async () => {
    const controller = new AbortController()
    let closed = 0
    const runtime = createSessionRuntime({
        workDir: 'D:/project',
        opts: {abortController: controller},
        query: {close() { closed += 1 }},
    })
    await runtime.cleanupRegistry.abort('stop_generation')
    assert.equal(closed, 1)
    assert.equal(controller.signal.aborted, true)
    assert.equal(controller.signal.reason, 'stop_generation')
})
