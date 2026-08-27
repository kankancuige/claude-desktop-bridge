import assert from 'node:assert/strict'
import test from 'node:test'
import {canDelegateWriteToParent, normalizePermissionMode, resolveEffectivePermissionMode} from './agent-permission.mjs'

test('权限入口统一规范化并由父会话覆盖 Agent 请求', () => {
    assert.equal(normalizePermissionMode('invalid'), 'default')
    assert.equal(resolveEffectivePermissionMode({parentPermissionMode: 'bypassPermissions', agentPermissionMode: 'plan'}), 'bypassPermissions')
    assert.equal(resolveEffectivePermissionMode({agentPermissionMode: 'acceptEdits'}), 'acceptEdits')
})

test('只读 Agent 始终交由主任务代写，plan 会话不允许直接写入', () => {
    assert.equal(canDelegateWriteToParent({permissionMode: 'bypassPermissions', agentWritable: false}), true)
    assert.equal(canDelegateWriteToParent({permissionMode: 'plan', agentWritable: true}), true)
})
