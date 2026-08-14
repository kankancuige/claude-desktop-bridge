import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

import {
    attachTaskWorkflow,
    clearTaskWorkflowGate,
    consumeTaskWorkflowResultTurn,
    createTaskWorkflowGate,
    deferPrimaryResultForTaskWorkflow,
    finishTaskWorkflowResultTurn,
    hasPendingTaskWorkflow,
    isInternalWorkflowResultText,
    noteTaskWorkflowTerminal,
    taskWorkflowResultIdFromMessage,
    taskWorkflowResultMarker,
    takeDeferredPrimaryResult,
} from './task-workflow-gate.mjs'

test('任务拥有的 Workflow 结束后仍等待其结果回合被 SDK 消费', () => {
    const gate = createTaskWorkflowGate()
    attachTaskWorkflow(gate, 'wf-1')
    assert.equal(noteTaskWorkflowTerminal(gate, 'wf-1'), true)
    assert.equal(hasPendingTaskWorkflow(gate), true)
    assert.equal(consumeTaskWorkflowResultTurn(gate, 'wf-1'), true)
    assert.equal(hasPendingTaskWorkflow(gate), true)
    assert.deepEqual(finishTaskWorkflowResultTurn(gate, 'wf-1'), {
        consumed: true,
        deferredPrimaryResult: null,
    })
    assert.equal(hasPendingTaskWorkflow(gate), false)
})

test('主结果等待所有任务 Workflow 和结果回合结束后才能结算', () => {
    const gate = createTaskWorkflowGate()
    attachTaskWorkflow(gate, 'wf-1')
    assert.equal(deferPrimaryResultForTaskWorkflow(gate, {result: 'primary'}), true)
    assert.equal(takeDeferredPrimaryResult(gate), null)
    noteTaskWorkflowTerminal(gate, 'wf-1')
    consumeTaskWorkflowResultTurn(gate, 'wf-1')
    assert.deepEqual(finishTaskWorkflowResultTurn(gate, 'wf-1'), {
        consumed: true,
        deferredPrimaryResult: {result: 'primary'},
    })
    assert.equal(takeDeferredPrimaryResult(gate), null)
})

test('只有携带已登记 workflowId 的内部结果消息才能解除等待', () => {
    const gate = createTaskWorkflowGate()
    attachTaskWorkflow(gate, 'wf-real')
    noteTaskWorkflowTerminal(gate, 'wf-real')
    assert.equal(consumeTaskWorkflowResultTurn(gate, 'wf-other'), false)
    assert.equal(hasPendingTaskWorkflow(gate), true)
    const message = {content: [{type: 'text', text: `${taskWorkflowResultMarker('wf-real')}\n结果`}]}
    assert.equal(taskWorkflowResultIdFromMessage(message), 'wf-real')
    assert.equal(isInternalWorkflowResultText(message.content[0].text), true)
    assert.equal(consumeTaskWorkflowResultTurn(gate, taskWorkflowResultIdFromMessage(message)), true)
    assert.equal(finishTaskWorkflowResultTurn(gate, 'wf-other').consumed, false)
    assert.equal(finishTaskWorkflowResultTurn(gate, 'wf-real').consumed, true)
})

test('普通用户补充消息不能伪装成 Workflow 结果', () => {
    assert.equal(taskWorkflowResultIdFromMessage({content: [{type: 'text', text: '继续补充这个功能'}]}), null)
    assert.equal(isInternalWorkflowResultText('继续补充这个功能'), false)
})

test('不回灌父会话的 Workflow 终态无需等待额外 SDK 回合', () => {
    const gate = createTaskWorkflowGate()
    attachTaskWorkflow(gate, 'review')
    noteTaskWorkflowTerminal(gate, 'review', {returnsToParent: false})
    assert.equal(hasPendingTaskWorkflow(gate), false)
})

test('停止父任务时清空 Workflow 门禁和延迟结果', () => {
    const gate = createTaskWorkflowGate()
    attachTaskWorkflow(gate, 'wf-1')
    deferPrimaryResultForTaskWorkflow(gate, {type: 'primary_result'})
    assert.equal(clearTaskWorkflowGate(gate), true)
    assert.equal(hasPendingTaskWorkflow(gate), false)
    assert.equal(takeDeferredPrimaryResult(gate), null)
})

test('Gateway 将内部 Workflow 回合与用户主任务结果分支处理', () => {
    const source = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
    assert.match(source, /_internalWorkflowResultTurnId\s*=\s*consumedWorkflowResult/)
    assert.match(source, /s\._taskWorkflowGate\s*=\s*createTaskWorkflowGate\(\)\s*\r?\n\s*s\._internalWorkflowResultTurnId\s*=\s*null/)
    assert.match(source, /finishTaskWorkflowResultTurn\(\s*s\._taskWorkflowGate,\s*s\._internalWorkflowResultTurnId,?\s*\)/)

    const internalBranch = source.indexOf('if (sdkMsg.type === \'result\' && s._internalWorkflowResultTurnId)')
    const primaryBranch = source.indexOf("else if (sdkMsg.type === 'result') {", internalBranch + 1)
    const primaryMutation = source.indexOf('s.lastTaskResult = {', internalBranch)
    assert.ok(internalBranch >= 0, '缺少内部 Workflow 结果分支')
    assert.ok(primaryBranch > internalBranch, '缺少普通主结果分支')
    assert.ok(primaryMutation > primaryBranch, '内部 Workflow 回合仍会覆盖主任务结果')
})
