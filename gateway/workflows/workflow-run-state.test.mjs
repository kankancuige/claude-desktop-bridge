import assert from 'node:assert/strict'
import {test} from 'node:test'
import {getRunState, getSessionWorkflowStates, presetRunState, stopWorkflow} from './workflow-runner.mjs'

test('同名 Workflow 在 starting 状态时拒绝重复启动', () => {
    const name = `duplicate-${Date.now()}.mjs`
    const workflowId = presetRunState(name)
    assert.equal(getRunState(name)?.wfId, workflowId)
    assert.throws(() => presetRunState(name), error => error?.code === 'WORKFLOW_ALREADY_RUNNING')
})

test('同一 Workflow 使用不同运行键时允许不同会话并行', () => {
    const name = `parallel-${Date.now()}.mjs`
    const first = presetRunState(name, `${name}:session-a`)
    const second = presetRunState(name, `${name}:session-b`)
    assert.notEqual(first, second)
})

test('预注册 starting 状态保留父会话身份并进入会话快照', () => {
    const name = `starting-${Date.now()}.mjs`
    const wfId = presetRunState(name, `${name}:session-c`, 'session-c')
    assert.equal(getSessionWorkflowStates('session-c').find(state => state.wfId === wfId)?.status, 'starting')
})

test('预注册 starting 状态可以在 runner 启动前停止', () => {
    const name = `cancel-starting-${Date.now()}.mjs`
    const wfId = presetRunState(name, `${name}:session-d`, 'session-d')
    assert.equal(stopWorkflow(wfId), true)
    assert.equal(getRunState(wfId)?.status, 'stopped')
})
