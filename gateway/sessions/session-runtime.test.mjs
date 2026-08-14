import test from 'node:test'
import assert from 'node:assert/strict'

import {createSessionRuntime} from './session-runtime.mjs'

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
