import test from 'node:test'
import assert from 'node:assert/strict'

import {resolveMappedGatewaySessionId, updateSessionMap} from './session-map-consistency.mjs'

test('正反向一致时返回 Gateway Session ID', () => {
    const map = {'gw-1': 'sdk-1', '@rev:sdk-1': 'gw-1'}
    assert.equal(resolveMappedGatewaySessionId(map, 'sdk-1'), 'gw-1')
})

test('旧反向项指向已绑定其他 SDK 会话的 Gateway Session 时拒绝复用', () => {
    const map = {
        'gw-1': 'sdk-2',
        '@rev:sdk-1': 'gw-1',
        '@rev:sdk-2': 'gw-1',
    }
    assert.equal(resolveMappedGatewaySessionId(map, 'sdk-1'), null)
    assert.equal(resolveMappedGatewaySessionId(map, 'sdk-2'), 'gw-1')
})

test('更新 Gateway 映射时删除它原来的反向项', () => {
    const next = updateSessionMap({
        'gw-1': 'sdk-old',
        '@rev:sdk-old': 'gw-1',
    }, 'gw-1', 'sdk-new')
    assert.deepEqual(next, {
        'gw-1': 'sdk-new',
        '@rev:sdk-new': 'gw-1',
    })
})
