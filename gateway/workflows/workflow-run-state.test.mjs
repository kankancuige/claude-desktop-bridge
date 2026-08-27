import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createWorkflowRuntime, getRunState, getSessionWorkflowStates, presetRunState, serializeSessionWorkflowState, stopWorkflow} from './workflow-runner.mjs'

test('Workflow Runtime 实例的异步依赖上下文彼此隔离', () => {
    const sessionA = `session-a-${Date.now()}`
    const sessionB = `session-b-${Date.now()}`
    const make = (sessionId, name) => createWorkflowRuntime({
        sessions: new Map([[sessionId, {workDir: `D:/${name}`}]]),
        encodeProjectName: () => name,
        workflowRepository: {available: true, list: () => [{
            workflowId: `${name}-id`, name, status: 'running', parentSessionId: sessionId,
            projectKey: name, revision: 1, startedAt: Date.now(), state: {runKey: `${name}:${sessionId}`},
        }], upsert() {}},
    })
    const first = make(sessionA, 'workflow-a')
    const second = make(sessionB, 'workflow-b')
    assert.equal(first.getSessionWorkflowStates(sessionA)[0]?.name, 'workflow-a')
    assert.equal(second.getSessionWorkflowStates(sessionB)[0]?.name, 'workflow-b')
})

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

test('重启后从 PostgreSQL 恢复父会话 Workflow，存活状态降为可恢复暂停态', () => {
    const sessionId = `restored-session-${Date.now()}`
    const workflowId = `wf-restored-${Date.now()}`
    const saved = []
    const runtime = createWorkflowRuntime({
        sessions: new Map([[sessionId, {workDir: 'D:/demo'}]]),
        encodeProjectName: () => 'D--demo',
        workflowRepository: {
            available: true,
            list: () => [{
                projectKey: 'D--demo', workflowId, parentSessionId: sessionId,
                name: 'final-review', status: 'running', currentPhase: 'Review', tokenSpent: 42,
                startedAt: 10, revision: 3,
                state: {name: 'final-review', status: 'running', currentPhase: 'Review', tokenSpent: 42,
                    phases: [{title: 'Review', status: 'running'}], runKey: `final-review:${sessionId}`},
            }],
            upsert: row => saved.push(row),
        },
    })
    const restored = runtime.getSessionWorkflowStates(sessionId).find(item => item.wfId === workflowId)
    assert.equal(restored.status, 'paused')
    assert.equal(restored.currentPhase, 'Review')
    assert.equal(restored.tokenSpent, 42)
    assert.equal(getRunState(workflowId)?.status, 'paused')
    assert.equal(saved.at(-1).status, 'paused')
})

test('Workflow 快照保留 Agent 实际状态并包含已完成 Agent', () => {
    const state = {
        name: 'review', status: 'running', phases: [], startedAt: 1,
        _agentHandles: new Map([
            ['active', {status: 'running', _prompt: '执行中'}],
            ['paused-live', {status: 'paused', _prompt: '暂停中'}],
        ]),
        _pausedAgents: new Map([['paused', {prompt: '等待恢复'}]]),
        _journalCache: {
            doneHash: {label: 'done', prompt: '已完成检查', result: 'ok', timestamp: 2},
        },
    }
    const snapshot = serializeSessionWorkflowState('wf-1', state)
    assert.equal(snapshot.agents.find(agent => agent.id === 'active').status, 'running')
    assert.equal(snapshot.agents.find(agent => agent.id === 'paused-live').status, 'paused')
    assert.equal(snapshot.agents.find(agent => agent.id === 'paused').status, 'paused')
    assert.equal(snapshot.agents.find(agent => agent.id === 'done').status, 'done')
})
