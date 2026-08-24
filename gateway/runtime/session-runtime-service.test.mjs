import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionRuntimeService} from './session-runtime-service.mjs'

test('Session Runtime 统一拥有会话池、输入队列和协调器', () => {
    const runtime = createSessionRuntimeService({maxPending: 4, imSources: ['wechat']})
    const session = {id: 's1'}
    runtime.register('s1', session)
    assert.equal(runtime.get('s1'), session)
    assert.ok(runtime.coordinator)
    assert.equal(runtime.setFocusedSession('s1'), true)
    assert.equal(runtime.focusedSessionId, 's1')
})

test('重复注册和未知聚焦会话显式拒绝，注销会清理聚焦状态', () => {
    const runtime = createSessionRuntimeService()
    runtime.register('s1', {})
    assert.equal(runtime.setFocusedSession('missing'), false)
    assert.throws(() => runtime.register('s1', {}), error => error.code === 'SESSION_ALREADY_REGISTERED')
    assert.equal(runtime.unregister('s1'), true)
    assert.equal(runtime.focusedSessionId, null)
})

test('释放后禁止重新注册并且幂等清空会话池', () => {
    const runtime = createSessionRuntimeService()
    runtime.register('s1', {})
    assert.equal(runtime.dispose(), true)
    assert.equal(runtime.dispose(), false)
    assert.equal(runtime.sessions.size, 0)
    assert.throws(() => runtime.register('s2', {}), error => error.code === 'SESSION_RUNTIME_DISPOSED')
})
