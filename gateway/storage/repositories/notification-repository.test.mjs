import test from 'node:test'
import assert from 'node:assert/strict'
import {createNotificationRepository} from './notification-repository.mjs'

function makeStore() {
    const calls = []
    return {
        calls,
        listTaskNotificationIntents(platform, options) { calls.push(['listPending', platform, options]); return [{taskId: 't1'}] },
        updateTaskNotification(input) { calls.push(['updateState', input]); return true },
        summarizeEntries(kind, platform, states) { calls.push(['summarize', kind, platform, states]); return {pending: 1} },
        clearEntries(kind, platform) { calls.push(['clear', kind, platform]); return kind === 'inbox' ? 2 : 3 },
    }
}

test('Notification Repository 只暴露通知意图操作', () => {
    const store = makeStore()
    const repository = createNotificationRepository({stateStore: store})
    assert.deepEqual(repository.listPending({platform: 'wechat', limit: 20}), [{taskId: 't1'}])
    assert.equal(repository.updateState({taskId: 't1', platform: 'wechat', state: 'sent'}), true)
    assert.deepEqual(repository.summarize({platform: 'wechat'}), {pending: 1})
    assert.deepEqual(repository.clearPlatform('wechat'), {inbox: 2, notifications: 3})
    assert.equal(store.calls.length, 5)
})

test('Notification Repository 拒绝缺少平台', () => {
    assert.throws(() => createNotificationRepository({stateStore: makeStore()}).listPending(), /platform is required/)
})
