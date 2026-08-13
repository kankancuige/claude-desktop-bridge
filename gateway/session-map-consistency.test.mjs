import test from 'node:test'
import assert from 'node:assert/strict'

import {removeSessionMapEntry, resolveMappedGatewaySessionId, updateSessionMap} from './session-map-consistency.mjs'

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

test('仅删除正反向一致的指定 Session 映射', () => {
    const next = removeSessionMapEntry({
        'wf-agent-1': 'sdk-agent-1',
        '@rev:sdk-agent-1': 'wf-agent-1',
        'gw-main': 'sdk-main',
        '@rev:sdk-main': 'gw-main',
    }, 'wf-agent-1', 'sdk-agent-1')

    assert.deepEqual(next, {
        'gw-main': 'sdk-main',
        '@rev:sdk-main': 'gw-main',
    })
})

test('Session 已被并发更新时不删除新映射', () => {
    const map = {
        'wf-agent-1': 'sdk-agent-new',
        '@rev:sdk-agent-new': 'wf-agent-1',
        '@rev:sdk-agent-old': 'wf-agent-1',
    }

    assert.deepEqual(removeSessionMapEntry(map, 'wf-agent-1', 'sdk-agent-old'), map)
})
