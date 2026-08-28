import assert from 'node:assert/strict'
import test from 'node:test'
import {clearSessionToolActivity, observeSessionToolActivity, settleSessionToolConfirmation} from './session-tool-activity.mjs'

test('工具开始、progress、tool_result 和 result 正确维护活动快照', () => {
    const session = {}
    observeSessionToolActivity(session, {type: 'stream_event'}, {
        type: 'tool_use_start', tool_use_id: 'tool-1', tool_name: 'Bash', index: 0,
    }, 100)
    assert.equal(session._activeTools.size, 1)
    assert.equal(session._activeTools.get('tool-1').startedAt, 100)

    observeSessionToolActivity(session, {type: 'tool_progress'}, {
        type: 'tool_progress', tool_use_id: 'tool-1', tool_name: 'Bash',
    }, 250)
    assert.equal(session._activeTools.get('tool-1').lastProgressAt, 250)

    observeSessionToolActivity(session, {type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 'tool-1'}]}}, null, 300)
    assert.equal(session._activeTools.size, 0)

    observeSessionToolActivity(session, {type: 'result'}, null, 400)
    assert.equal(session._lastSdkEventAt, 400)
    clearSessionToolActivity(session)
    assert.equal(session._activeTools.size, 0)
})

test('AskUserQuestion 确认结算后清理对应工具活动，避免假装工具仍在执行', () => {
    const session = {}
    observeSessionToolActivity(session, {type: 'stream_event'}, {
        type: 'tool_use_start', tool_use_id: 'ask-1', tool_name: 'AskUserQuestion', index: 0,
    }, 100)
    settleSessionToolConfirmation(session, {type: 'choice', toolUseId: 'ask-1'}, 200)
    assert.equal(session._activeTools.size, 0)
    assert.equal(session._lastSdkEventAt, 200)
})

test('普通权限确认只刷新对应工具，不清理其他并发工具', () => {
    const session = {}
    observeSessionToolActivity(session, {type: 'stream_event'}, {type: 'tool_use_start', tool_use_id: 'a', tool_name: 'Bash'}, 100)
    observeSessionToolActivity(session, {type: 'stream_event'}, {type: 'tool_use_start', tool_use_id: 'b', tool_name: 'Read'}, 110)
    settleSessionToolConfirmation(session, {type: 'permission', toolUseId: 'a'}, 200)
    assert.equal(session._activeTools.has('a'), true)
    assert.equal(session._activeTools.get('a').lastProgressAt, 200)
    assert.equal(session._activeTools.get('b').lastProgressAt, 110)
})
