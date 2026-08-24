import test from 'node:test'
import assert from 'node:assert/strict'
import {createTaskCommandRuntime} from './task-command-runtime.mjs'

test('Task Command Runtime 通过显式依赖创建并稳定拒绝不存在会话', async () => {
    const runtime = createTaskCommandRuntime({
        sessions: new Map(),
        taskInputQueue: {},
        sessionCoordinator: {},
        IM_SOURCES: new Set(),
    })
    assert.equal(typeof runtime.submitTaskCommand, 'function')
    assert.deepEqual(
        await runtime.submitTaskCommand({sessionId: 'missing', messageId: 'm-1'}),
        {type: 'message_rejected', messageId: 'm-1', code: 'session_not_found'},
    )
})

test('Task Command Runtime 缺少会话边界依赖时立即失败', () => {
    assert.throws(
        () => createTaskCommandRuntime({sessions: new Map()}),
        /task runtime dependencies are required/,
    )
})
