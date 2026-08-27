import assert from 'node:assert/strict'
import test from 'node:test'
import {clearSessionToolActivity, observeSessionToolActivity} from './session-tool-activity.mjs'

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
