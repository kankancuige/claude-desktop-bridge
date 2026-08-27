import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createWebSocketSessionRuntime} from './websocket-session-runtime.mjs'

class FakeWss extends EventEmitter {}

const desktopRuntimeDeps = {
    safeDecodeURIComponent: decodeURIComponent,
    adapterOwnsSession: () => false,
    getFocusedSessionId: () => null,
    setFocusedSessionId() {},
    taskStateForSessionClient: () => null,
    getTaskLifecycleSnapshot: () => null,
    userPreferences: {pending: () => []},
    VALID_PERMISSION_MODES: new Set(['default', 'bypassPermissions']),
    broadcastDesktop() {},
}

function createConnectedRuntime({decisionToResult, settlePending}) {
    const wss = new FakeWss()
    const session = {pending: new Map(), clients: new Set(), mirrors: {}}
    createWebSocketSessionRuntime({
        ...desktopRuntimeDeps,
        wss, controlClients: new Set(), sessions: new Map([['s', session]]), IM_SOURCES: new Set(),
        getSessionRuntimeState: () => ({}), getSessionWorkflowState: () => null, getSessionWorkflowStates: () => [],
        updateTaskState() {}, persistSessionCatalogSettings() {}, settlePending, decisionToResult,
        taskCommands: {submitTask: async () => ({})}, log: {info() {}, error() {}, debug() {}},
    })
    const sent = []
    const ws = new EventEmitter()
    Object.assign(ws, {readyState: 1, send(raw) { sent.push(JSON.parse(raw)) }, close() {}})
    wss.emit('connection', ws, {url: '/ws/session/s?source=desktop', bridgeWsAuth: {kind: 'desktop'}})
    return {session, ws, sent}
}

test('桌面重连收到同一会话的全部 Workflow 快照', () => {
    const wss = new FakeWss()
    const session = {pending: new Map(), clients: new Set(), mirrors: {}}
    createWebSocketSessionRuntime({
        ...desktopRuntimeDeps,
        wss, controlClients: new Set(), sessions: new Map([['s', session]]), IM_SOURCES: new Set(),
        getSessionRuntimeState: () => ({}),
        getSessionWorkflowState: () => ({wfId: 'wf-1', name: 'one'}),
        getSessionWorkflowStates: () => [{wfId: 'wf-1', name: 'one'}, {wfId: 'wf-2', name: 'two'}],
        updateTaskState() {}, persistSessionCatalogSettings() {},
        taskCommands: {submitTask: async () => ({})}, log: {info() {}, error() {}, debug() {}},
    })
    const sent = []
    const ws = new EventEmitter()
    Object.assign(ws, {readyState: 1, send(raw) { sent.push(JSON.parse(raw)) }, close() {}})
    wss.emit('connection', ws, {url: '/ws/session/s?source=desktop', bridgeWsAuth: {kind: 'desktop'}})
    const snapshot = sent.find(event => event.type === 'workflow_states_snapshot')
    assert.deepEqual(snapshot.workflows.map(workflow => workflow.wfId), ['wf-1', 'wf-2'])
    assert.equal(snapshot.currentWorkflow.wfId, 'wf-1')
})

test('WebSocket Session Runtime 注册连接边界并拒绝缺少会话', () => {
    const wss = new FakeWss()
    const controlClients = new Set()
    const runtime = createWebSocketSessionRuntime({
        wss, controlClients, sessions: new Map(), IM_SOURCES: new Set(),
    })
    assert.equal(runtime.controlClients, controlClients)
    const ws = {close(code) { this.closed = code }}
    wss.emit('connection', ws, {url: '/ws/session/missing', bridgeWsAuth: {kind: 'desktop'}})
    assert.equal(ws.closed, 4000)
})

test('WebSocket Session Runtime 缺少边界依赖时立即失败', () => {
    assert.throws(
        () => createWebSocketSessionRuntime({sessions: new Map()}),
        /websocket session dependencies are required/,
    )
})

test('choice_response 不完整时保留 pending，不释放 AI Promise', async () => {
    let settlements = 0
    const {session, ws, sent} = createConnectedRuntime({
        decisionToResult: () => ({incomplete: true, answers: {'问题一': 'A'}, message: '请继续回答'}),
        settlePending: () => { settlements++; return true },
    })
    session.pending.set('r1', {type: 'choice', input: {questions: []}})
    ws.emit('message', Buffer.from(JSON.stringify({type: 'choice_response', requestId: 'r1', answers: {'问题一': 'A'}})))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(settlements, 0)
    assert.equal(session.pending.has('r1'), true)
    assert.deepEqual(session.pending.get('r1').input.answers, {'问题一': 'A'})
    assert.equal(sent.at(-1).code, 'confirmation_incomplete')
})

test('choice_response 完整时只结算一次并返回 confirmed', async () => {
    let settlements = 0
    const {session, ws, sent} = createConnectedRuntime({
        decisionToResult: () => ({behavior: 'allow', updatedInput: {answers: {'问题一': 'A'}}}),
        settlePending: () => { settlements++; return true },
    })
    session.pending.set('r1', {type: 'choice', input: {questions: []}})
    ws.emit('message', Buffer.from(JSON.stringify({type: 'choice_response', requestId: 'r1', answers: {'问题一': 'A'}})))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(settlements, 1)
    assert.equal(sent.at(-1).code, 'confirmed')
})
