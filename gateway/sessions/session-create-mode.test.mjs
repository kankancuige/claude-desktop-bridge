import test from 'node:test'
import assert from 'node:assert/strict'

import {initialSessionIdentity, resolveRecoveryRuntimeIdentity, resolveSessionCreateMode} from './session-create-mode.mjs'

test('未指定来源时创建空白会话', () => {
    assert.deepEqual(resolveSessionCreateMode({}), {mode: 'new', sourceSessionId: null})
})

test('resume 和 forkFrom 分别产生明确创建模式', () => {
    assert.deepEqual(resolveSessionCreateMode({resume: 'sdk-old'}), {mode: 'resume', sourceSessionId: 'sdk-old'})
    assert.deepEqual(resolveSessionCreateMode({forkFrom: 'sdk-old'}), {mode: 'fork', sourceSessionId: 'sdk-old'})
    assert.deepEqual(resolveSessionCreateMode({recoverSessionId: 'gateway-old'}), {mode: 'recover', sourceSessionId: 'gateway-old'})
})

test('resume 与 forkFrom 不能同时出现', () => {
    assert.throws(() => resolveSessionCreateMode({resume: 'sdk-a', forkFrom: 'sdk-b'}), /mutually exclusive/)
    assert.throws(() => resolveSessionCreateMode({resume: 'sdk-a', recoverSessionId: 'gateway-a'}), /mutually exclusive/)
    assert.throws(() => resolveSessionCreateMode({forkFrom: 'sdk-a', recoverSessionId: 'gateway-a'}), /mutually exclusive/)
})

test('空白或非字符串来源被拒绝', () => {
    assert.throws(() => resolveSessionCreateMode({forkFrom: '  '}), /invalid forkFrom/)
    assert.throws(() => resolveSessionCreateMode({resume: 42}), /invalid resume/)
})

test('恢复来源在 system init 前即成为 runtime identity', () => {
    assert.deepEqual(initialSessionIdentity('sdk-old'), {
        hasUserTurns: true,
        lastSessionId: 'sdk-old',
        _hasConversation: true,
    })
    assert.deepEqual(initialSessionIdentity(null), {
        hasUserTurns: false,
        lastSessionId: null,
        _hasConversation: false,
    })
})

test('recovery-only 优先保留 SDK conversation identity', () => {
    assert.equal(resolveRecoveryRuntimeIdentity({sdkSessionId: 'sdk-1', historySessionId: 'history-1'}), 'sdk-1')
    assert.equal(resolveRecoveryRuntimeIdentity({historySessionId: 'history-1'}), 'history-1')
    assert.equal(resolveRecoveryRuntimeIdentity({}), null)
})
