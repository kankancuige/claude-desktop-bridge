import assert from 'node:assert/strict'
import {test} from 'node:test'
import {getRunState, getSessionWorkflowStates, presetRunState, setDeps, stopWorkflow} from './workflow-runner.mjs'

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

test('重启后从 SQLite 恢复父会话 Workflow，存活状态降为可恢复暂停态', () => {
    const sessionId = `restored-session-${Date.now()}`
    const workflowId = `wf-restored-${Date.now()}`
    const saved = []
    setDeps({
        sessions: new Map([[sessionId, {workDir: 'D:/demo'}]]),
        encodeProjectName: () => 'D--demo',
        stateStore: {
            available: true,
            listWorkflowStates: () => [{
                projectKey: 'D--demo', workflowId, parentSessionId: sessionId,
                name: 'final-review', status: 'running', currentPhase: 'Review', tokenSpent: 42,
                startedAt: 10, revision: 3,
                state: {name: 'final-review', status: 'running', currentPhase: 'Review', tokenSpent: 42,
                    phases: [{title: 'Review', status: 'running'}], runKey: `final-review:${sessionId}`},
            }],
            upsertWorkflowState: row => saved.push(row),
        },
    })
    const restored = getSessionWorkflowStates(sessionId).find(item => item.wfId === workflowId)
    assert.equal(restored.status, 'paused')
    assert.equal(restored.currentPhase, 'Review')
    assert.equal(restored.tokenSpent, 42)
    assert.equal(getRunState(workflowId)?.status, 'paused')
    assert.equal(saved.at(-1).status, 'paused')
})
