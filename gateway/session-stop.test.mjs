import assert from 'node:assert/strict'
import {test} from 'node:test'
import {buildSessionStopResponse, hasStoppableSessionWork} from './session-stop.mjs'

test('空闲 Session 不应报告可停止', () => {
    assert.equal(hasStoppableSessionWork(null), false)
    assert.equal(hasStoppableSessionWork({query: {}, pushStream: {}}), false)
})

test('运行、重建、确认和排队状态均可停止', () => {
    assert.equal(hasStoppableSessionWork({_generating: true}), true)
    assert.equal(hasStoppableSessionWork({activeTurnId: 'turn-1'}), true)
    assert.equal(hasStoppableSessionWork({pendingTurn: {}}), true)
    assert.equal(hasStoppableSessionWork({_rebuildPromise: Promise.resolve()}), true)
    assert.equal(hasStoppableSessionWork({pending: new Map([['request-1', {}]])}), true)
    assert.equal(hasStoppableSessionWork({_pendingInputs: [{}]}), true)
    assert.equal(hasStoppableSessionWork({_pendingTurns: [{}]}), true)
})

test('停止响应明确说明会话是否可以继续', () => {
    assert.deepEqual(buildSessionStopResponse({lastSessionId: 'sdk-1'}, {stopped: true, cancelledInputs: 2}), {
        stopped: true,
        cancelledInputs: 2,
        resumable: true,
        historySessionId: 'sdk-1',
    })
    assert.deepEqual(buildSessionStopResponse({}, {stopped: false}), {
        stopped: false,
        cancelledInputs: 0,
        resumable: false,
        historySessionId: null,
    })
})
