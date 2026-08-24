import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionStateStorageRuntime} from './session-state-storage-runtime.mjs'

function makeRuntime(overrides = {}) {
    return createSessionStateStorageRuntime({
        bridgeHome: 'D:/bridge', joinPath: (...parts) => parts.join('/'), encodeProjectName: value => value,
        normalizeWorkDir: value => value, mirrorStorePath: value => `${value}/mirrors.json`,
        mirrorSessionIds: (...ids) => ids.filter(Boolean), getPersistedMirrors: () => ({}),
        setPersistedMirror: value => value, setPersistedMirrors: value => value,
        removePersistedMirrors: value => value, readJSON: () => null, writeJSON() {},
        existsSync: () => false, statSync: () => null,
        getSessionRepository: () => null, isUserSessionSource: () => true,
        SessionEventJournal: class {append(type, payload) { return {type, payload} }},
        sessionEventStorePath: (dir, id) => `${dir}/${id}.jsonl`, ...overrides,
    })
}

test('Session 状态存储 Runtime 统一生成项目键和镜像键', () => {
    const runtime = makeRuntime()
    assert.equal(runtime.sessionCatalogProjectKey('D:/work'), 'D:/work')
    assert.deepEqual(runtime.sessionMirrorIds({lastSessionId: 'sdk'}, 'gateway'), ['gateway', 'sdk'])
})

test('Session 状态存储 Runtime 通过事件 Journal 端口写入事件', () => {
    const runtime = makeRuntime()
    const session = {eventJournal: runtime.openSessionEventJournal('D:/work', 's1')}
    assert.deepEqual(runtime.appendSessionEvent(session, 'test', {ok: true}), {type: 'test', payload: {ok: true}})
})

test('Session 状态存储 Runtime 缺少端口时立即失败', () => {
    assert.throws(() => createSessionStateStorageRuntime(), /dependencies are required/)
})
