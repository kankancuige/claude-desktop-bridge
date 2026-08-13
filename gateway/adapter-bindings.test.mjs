import assert from 'node:assert/strict'
import {
    findLatestAdapterUserForSession,
    listAdapterBindings,
    maskAdapterUserId,
    normalizeAdapterBindings,
    removeAdapterBindings,
    upsertAdapterBinding,
} from './adapter-bindings.mjs'

const platforms = ['wechat', 'feishu', 'dingtalk']
const source = {
    'wechat:wx-user-1234': {
        platform: 'wechat', userId: 'wx-user-1234', sessionId: 's-live', workDir: 'D:\\code', updatedAt: 200,
    },
    'feishu:ou_abc': {
        platform: 'feishu', userId: 'ou_abc', sessionId: 's-stale', workDir: 'D:\\other', updatedAt: 100,
    },
    'wechat:wrong-key': {platform: 'wechat', userId: 'different', sessionId: 's1', updatedAt: 1},
    'unknown:u1': {platform: 'unknown', userId: 'u1', sessionId: 's1', updatedAt: 1},
}

assert.equal(maskAdapterUserId('abcd'), '••••')
assert.equal(maskAdapterUserId('abcdef'), 'ab••ef')
assert.deepEqual(Object.keys(normalizeAdapterBindings(source, platforms)).sort(), ['feishu:ou_abc', 'wechat:wx-user-1234'])

const listed = listAdapterBindings(source, {
    allowedPlatforms: platforms,
    isSessionActive: sessionId => sessionId === 's-live',
})
assert.deepEqual(listed, [
    {platform: 'wechat', userId: 'wx••••••••34', sessionId: 's-live', boundAt: 200, active: true},
    {platform: 'feishu', userId: 'ou••bc', sessionId: 's-stale', boundAt: 100, active: false},
])

const stale = removeAdapterBindings(source, binding => binding.sessionId !== 's-live', platforms)
assert.equal(stale.deleted, 1)
assert.deepEqual(Object.keys(stale.bindings), ['wechat:wx-user-1234'])

const exact = removeAdapterBindings(source, binding => binding.platform === 'wechat' && binding.userId === 'wx-user-1234', platforms)
assert.equal(exact.deleted, 1)
assert.equal(exact.bindings['wechat:wx-user-1234'], undefined)

assert.equal(findLatestAdapterUserForSession({
    a: {platform: 'wechat', userId: 'old', sessionId: 's1', updatedAt: 1},
    b: {platform: 'wechat', userId: 'new', sessionId: 's1', updatedAt: 2},
    c: {platform: 'feishu', userId: 'other', sessionId: 's1', updatedAt: 3},
}, 'wechat', 's1'), 'new')

const multiUser = upsertAdapterBinding(source, {
    platform: 'wechat', userId: 'wx-user-5678', sessionId: 's-live', workDir: 'D:\\code', updatedAt: 300,
}, platforms)
assert.equal(multiUser['wechat:wx-user-1234'].sessionId, 's-live')
assert.equal(multiUser['wechat:wx-user-5678'].sessionId, 's-live')

console.log('adapter-bindings tests passed')
