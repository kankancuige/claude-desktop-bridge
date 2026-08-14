import assert from 'node:assert/strict'
import test from 'node:test'
import {scheduleSessionBackgroundInitialization} from './session-background-init.mjs'

test('会话后台初始化不会阻塞创建响应，并补齐快照、Git 和记录点', async () => {
    const session = {workDir: 'D:/work'}
    const sessions = new Map([['gw-1', session]])
    let deferred = null
    const scheduled = scheduleSessionBackgroundInitialization({
        sessionId: 'gw-1',
        session,
        getSession: id => sessions.get(id),
        loadSnapshot: () => null,
        buildSnapshot: () => ({files: new Map(), takenAt: 1}),
        saveSnapshot: value => { value.saved = true },
        buildGitContext: () => '[GitContext]',
        loadCheckpoints: () => [{id: 'cp-3'}],
        defer: callback => { deferred = callback },
    })

    assert.equal(scheduled, true)
    assert.equal(session.snapshot, undefined)
    assert.equal(typeof deferred, 'function')
    deferred()

    assert.equal(session.snapshotReady, true)
    assert.equal(session.saved, true)
    assert.equal(session._gitContext, '[GitContext]')
    assert.equal(session.checkpointSeq, 3)
    assert.equal(session.checkpointsLoaded, true)
})

test('被替换的旧会话实例不会接收迟到的后台扫描结果', () => {
    const oldSession = {workDir: 'D:/work'}
    const sessions = new Map([['gw-1', oldSession]])
    let deferred = null
    scheduleSessionBackgroundInitialization({
        sessionId: 'gw-1',
        session: oldSession,
        getSession: id => sessions.get(id),
        buildSnapshot: () => ({takenAt: 1}),
        defer: callback => { deferred = callback },
    })

    sessions.set('gw-1', {workDir: 'D:/work'})
    deferred()
    assert.equal(oldSession.snapshot, undefined)
})
