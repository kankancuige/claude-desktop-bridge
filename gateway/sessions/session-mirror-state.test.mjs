import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {
    getPersistedMirrors,
    mirrorSessionIds,
    mirrorStorePath,
    normalizeMirrorStore,
    removePersistedMirrors,
    setPersistedMirror,
} from './session-mirror-state.mjs'

test('会话镜像状态按 Gateway ID 和 SDK ID 建立持久化别名', () => {
    const store = setPersistedMirror({}, ['gateway-1', 'sdk-1'], 'wechat', true, 100)
    assert.deepEqual(getPersistedMirrors(store, ['sdk-1']), {wechat: true, feishu: false, dingtalk: false})
    assert.deepEqual(getPersistedMirrors(store, ['gateway-1']), {wechat: true, feishu: false, dingtalk: false})
    assert.equal(store.sessions['gateway-1'].updatedAt, 100)
})

test('损坏或非法镜像记录降级为默认值，不污染其他会话', () => {
    const store = normalizeMirrorStore({sessions: {'../escape': {mirrors: {wechat: true}}, 'sdk-2': {mirrors: {feishu: true}}}})
    assert.deepEqual(getPersistedMirrors(store, ['missing']), {wechat: false, feishu: false, dingtalk: false})
    assert.deepEqual(getPersistedMirrors(store, ['sdk-2']), {wechat: false, feishu: true, dingtalk: false})
    assert.deepEqual(mirrorSessionIds('sdk-2', '../escape', null), ['sdk-2'])
})

test('删除会话只移除对应别名，sidecar 路径固定在项目目录', () => {
    const store = setPersistedMirror({}, ['gateway-1', 'sdk-1'], 'dingtalk', true)
    store.sessions.other = {mirrors: {feishu: true}, ids: ['other'], updatedAt: 1}
    const next = removePersistedMirrors(store, ['sdk-1'])
    assert.equal(next.sessions['gateway-1'], undefined)
    assert.ok(next.sessions.other)
    assert.equal(mirrorStorePath('D:/project'), join('D:/project', 'bridge-session-mirrors.json'))
})
