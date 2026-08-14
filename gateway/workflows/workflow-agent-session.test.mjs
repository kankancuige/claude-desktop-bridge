import assert from 'node:assert/strict'
import test from 'node:test'

import {cleanupWorkflowAgentSession} from './workflow-runner.mjs'

test('Workflow Agent 清理向 SDK 传项目工作目录，并在删除后移除映射', async () => {
    const calls = []
    const result = await cleanupWorkflowAgentSession({
        deleteSession: async (sessionId, options) => calls.push(['delete', sessionId, options]),
        removeSdkSessionId: (...args) => {
            calls.push(['unmap', ...args])
            return true
        },
        workDir: 'D:\\project',
        gatewaySessionId: 'wf-agent-1',
        sdkSessionId: 'sdk-agent-1',
    })

    assert.deepEqual(calls, [
        ['delete', 'sdk-agent-1', {dir: 'D:\\project'}],
        ['unmap', 'D:\\project', 'wf-agent-1', 'sdk-agent-1'],
    ])
    assert.deepEqual(result, {deleted: true, mappingRemoved: true})
})

test('SDK 删除失败时保留 Agent 映射供项目列表过滤', async () => {
    let unmapCalled = false

    await assert.rejects(() => cleanupWorkflowAgentSession({
        deleteSession: async () => { throw new Error('session locked') },
        removeSdkSessionId: () => {
            unmapCalled = true
            return true
        },
        workDir: 'D:\\project',
        gatewaySessionId: 'wf-agent-1',
        sdkSessionId: 'sdk-agent-1',
    }), /session locked/)

    assert.equal(unmapCalled, false)
})
