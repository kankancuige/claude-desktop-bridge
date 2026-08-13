import assert from 'node:assert/strict'
import {createTurnIdentity, shouldDeliverTurnEvent, shouldRouteMirror} from './turn-routing.mjs'

const imSources = new Set(['wechat', 'feishu', 'dingtalk'])
const identity = createTurnIdentity('wechat', 'user-a', imSources)
assert.deepEqual(identity, {source: 'wechat', userId: 'user-a'})
assert.equal(createTurnIdentity('desktop', null, imSources), null)

assert.equal(shouldDeliverTurnEvent('desktop', null, identity), true)
assert.equal(shouldDeliverTurnEvent('wechat', 'user-a', identity), true)
assert.equal(shouldDeliverTurnEvent('wechat', 'user-b', identity), false)
assert.equal(shouldDeliverTurnEvent('feishu', 'user-a', identity), false)
assert.equal(shouldDeliverTurnEvent('wechat', 'user-a', null), false)

assert.equal(shouldRouteMirror('wechat', identity), true)
assert.equal(shouldRouteMirror('feishu', identity), false)
assert.equal(shouldRouteMirror('feishu', null), true)
console.log('turn-routing tests passed')
