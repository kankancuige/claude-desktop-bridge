import assert from 'node:assert/strict'
import test from 'node:test'
import {createSessionStatePort} from './session-state-port.mjs'

test('Session State Port 唯一维护 Map 和 focused session', () => {
    const sessions = new Map()
    let focused = null
    const port = createSessionStatePort({
        sessions,
        getFocusedSessionId: () => focused,
        setFocusedSessionId: value => { focused = value },
    })
    const session = {workDir: 'D:/project'}
    port.set('s1', session)
    assert.equal(port.get('s1'), session)
    assert.equal(port.setFocusedSessionId('s1'), true)
    assert.equal(port.getFocusedSessionId(), 's1')
    assert.equal(port.delete('s1'), true)
    assert.equal(port.getFocusedSessionId(), null)
    assert.equal(sessions.size, 0)
})

test('Session State Port 拒绝失效 focused id 和释放后的写入', () => {
    let focused = null
    const port = createSessionStatePort({
        sessions: new Map(),
        getFocusedSessionId: () => focused,
        setFocusedSessionId: value => { focused = value },
    })
    assert.equal(port.setFocusedSessionId('missing'), false)
    port.dispose()
    assert.throws(() => port.set('s1', {}), error => error.code === 'SESSION_STATE_PORT_DISPOSED')
    assert.throws(() => port.setFocusedSessionId(null), error => error.code === 'SESSION_STATE_PORT_DISPOSED')
})
