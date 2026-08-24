import test from 'node:test'
import assert from 'node:assert/strict'
import {createBridgeAuthRuntime} from './bridge-auth-runtime.mjs'

test('Bridge Auth Runtime 区分桌面和 Adapter token', () => {
    const runtime = createBridgeAuthRuntime({bridgeHome: 'D:/bridge', bridgeTokenPath: 'D:/bridge/token', bridgeToken: 'desktop', adapterTokens: new Map([['wechat', 'adapter']]), mkdirSync() {}, writeFileSync() {}})
    assert.deepEqual(runtime.authenticateBridgeToken('desktop'), {kind: 'desktop'})
    assert.deepEqual(runtime.authenticateBridgeToken('adapter'), {kind: 'adapter', platform: 'wechat'})
    assert.equal(runtime.authenticateBridgeToken('bad'), null)
    assert.equal(runtime.safeDecodeURIComponent('%E0%A4%A'), '')
})

test('Bridge Auth Runtime 缺少依赖时立即失败', () => {
    assert.throws(() => createBridgeAuthRuntime(), /dependencies are required/)
})
