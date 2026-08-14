import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
    buildSessionStopResponse,
    getSessionStopScope,
    hasStoppablePrimaryWork,
    hasStoppableSessionWork,
} from './session-stop.mjs'

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
    assert.equal(hasStoppableSessionWork({taskCompletion: {phase: 'running'}}), true)
    assert.equal(hasStoppableSessionWork({taskCompletion: {phase: 'reviewing'}}), true)
    assert.equal(hasStoppableSessionWork({taskCompletion: {phase: 'changes_required'}}), true)
    assert.equal(hasStoppableSessionWork({taskCompletion: {phase: 'fixing'}}), true)
    assert.equal(hasStoppableSessionWork({}, [{status: 'done'}, {status: 'running'}]), true)
    assert.equal(hasStoppablePrimaryWork({taskCompletion: {phase: 'succeeded'}}), false)
    assert.equal(hasStoppablePrimaryWork({_generating: true}), true)
    assert.equal(hasStoppableSessionWork({}, {status: 'running', name: 'bug-hunter'}), true)
    assert.equal(hasStoppableSessionWork({}, {status: 'done', name: 'bug-hunter'}), false)
})

test('停止范围区分父任务和独立 Workflow', () => {
    const standalone = getSessionStopScope(
        {taskCompletion: {phase: 'succeeded'}},
        [{wfId: 'wf-standalone', status: 'running', taskOwned: false}],
    )
    assert.equal(standalone.primaryActive, false)
    assert.deepEqual(standalone.activeWorkflows.map(workflow => workflow.wfId), ['wf-standalone'])

    const taskOwned = getSessionStopScope(
        {taskCompletion: {phase: 'running'}},
        [{wfId: 'wf-task', status: 'running', taskOwned: true}],
    )
    assert.equal(taskOwned.primaryActive, true)
    assert.deepEqual(taskOwned.activeWorkflows.map(workflow => workflow.wfId), ['wf-task'])
})

test('停止响应明确说明会话是否可以继续', () => {
    assert.deepEqual(buildSessionStopResponse({lastSessionId: 'sdk-1'}, {stopped: true, cancelledInputs: 2}), {
        stopped: true,
        scope: 'none',
        cancelledInputs: 2,
        resumable: true,
        historySessionId: 'sdk-1',
    })
    assert.deepEqual(buildSessionStopResponse({}, {stopped: false}), {
        stopped: false,
        scope: 'none',
        cancelledInputs: 0,
        resumable: false,
        historySessionId: null,
    })
    assert.equal(buildSessionStopResponse({}, {stopped: true, scope: 'workflow'}).scope, 'workflow')
    assert.equal(buildSessionStopResponse({}, {stopped: true, scope: 'primary'}).scope, 'primary')
})
