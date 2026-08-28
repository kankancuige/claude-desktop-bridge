import test from 'node:test'
import assert from 'node:assert/strict'
import {createTaskCommandRuntime} from './task-command-runtime.mjs'
import {createTaskInputQueue} from '../sessions/task-input-queue.mjs'

test('Task Command Runtime 通过显式依赖创建并稳定拒绝不存在会话', async () => {
    const runtime = createTaskCommandRuntime({
        sessions: new Map(),
        taskInputQueue: {},
        sessionCoordinator: {},
        IM_SOURCES: new Set(),
    })
    assert.equal(typeof runtime.submitTaskCommand, 'function')
    assert.deepEqual(
        await runtime.submitTaskCommand({sessionId: 'missing', messageId: 'm-1'}),
        {type: 'message_rejected', messageId: 'm-1', code: 'session_not_found'},
    )
})

test('Task Command Runtime 缺少会话边界依赖时立即失败', () => {
    assert.throws(
        () => createTaskCommandRuntime({sessions: new Map()}),
        /task runtime dependencies are required/,
    )
})

test('Workbench 初始化失败会收口任务并返回可操作错误', async () => {
    const session = {id: 's1', workDir: 'D:\\work', queryOpts: {}, _pendingInputs: []}
    const sessions = new Map([['s1', session]])
    const queue = createTaskInputQueue({createId: () => 'generated'})
    const lifecycle = []
    const taskStateUpdates = []
    const runtime = createTaskCommandRuntime({
        sessions, taskInputQueue: queue, sessionCoordinator: {
            beginTurn() {}, invalidate() {}, isCurrent() { return true },
        }, IM_SOURCES: new Set(), log: {info() {}, warn() {}, error() {}, debug() {}},
        loadCliSettings: () => ({env: {}, model: 'model-a'}), VALID_MODEL_MODES: new Set(['auto', 'fixed']), MODEL: 'model-a',
        decideTask: () => ({version: 1, action: 'execute', complexity: 'simple', risk: 'low', modelTier: 'standard', workflow: false, finalReview: 'none', reasons: [], hardTriggers: [], contextProfile: 'full'}),
        resolveTurnModelRoute: () => ({model: 'model-a', mode: 'auto', tier: 'standard'}), loadWfConfig: () => ({modelTiers: {}}),
        validateProviderModel: () => null,
        acceptSessionInput: (target, source, messageId, userId, taskDecision) => queue.accept(target, {source, messageId, userId, taskDecision}),
        rollbackSessionInput: (target, accepted) => queue.rollback(target, accepted), appendSessionEvent() {}, markVisibleSession: () => true,
        isUserSessionSource: () => false, createTaskCompletionState: () => ({phase: 'running'}), createTurnIdentity: () => null,
        createTaskWorkflowGate: () => ({}), initializeTaskWorkbenchSession: async () => { throw new Error('Workbench 尚未连接') },
        userPreferences: {observe: () => []}, updateTaskState: (target, id, state) => { target.taskState = state; taskStateUpdates.push(state) },
        taskCompletionEventForClient: (target, _id, type, extra) => { target.taskState = {status: 'interrupted', outcome: 'failed', ...extra}; lifecycle.push({type, ...extra}) },
        broadcast: () => {}, resolveSdkInputContent: async (_id, _session, content) => content, buildTaskPitfallReminder: () => '',
        routeSkills: () => [], createSessionContextEnvelope: () => ({}), resolveContextReusePolicy: () => ({mode: 'reuse', reasonCodes: [], cacheEligibility: 'unknown'}),
        resolveProviderCapabilityProfile: () => ({}), buildModelHandoffPrompt: ({prompt}) => prompt, beginTurn() {}, shouldCaptureTurnCheckpoint: () => false,
        closeSessionRuntime: async () => {}, startClaudeAgent: () => ({}), PushStream: class {}, loadAgentDefinitions: () => [],
        getMakeQueryOptions: () => async () => ({}), getStartStreamPump: () => () => {}, failPendingSessionInputs: (id, target) => queue.drain(target),
        autoTriggerWorkflow: async () => {}, updateTaskCompletion: (target, id, event) => { target.taskCompletion = {phase: 'interrupted', detail: event.detail} },
        broadcastTaskLifecycle: id => lifecycle.push({type: 'lifecycle', id}), clearStreamWatchdog() {},
    })

    const result = await runtime.submitTaskCommand({sessionId: 's1', source: 'desktop', messageId: 'm1', content: '执行任务'})
    assert.equal(result.code, 'task_start_failed')
    assert.match(result.message, /Workbench 尚未连接/)
    assert.equal(session.taskState.status, 'interrupted')
    assert.equal(session.taskState.outcome, 'failed')
    assert.equal(session._pendingInputs.length, 0)
    assert.equal(lifecycle.some(item => item.type === 'task_failed'), true)
    assert.equal(lifecycle.some(item => item.type === 'lifecycle'), true)
    assert.equal(taskStateUpdates.length, 0)
})

test('复用已有 Query 接收输入后重新 arm watchdog', async () => {
    const pushed = []
    const armed = []
    const session = {
        id: 's2', workDir: 'D:\\work', query: {push(value) { pushed.push(value) }}, pushStream: {push(value) { pushed.push(value) }},
        queryOpts: {model: 'model-a'}, _generating: true, activeTurnId: 'turn-active', _pendingInputs: [],
        taskDecision: {version: 1, action: 'execute', complexity: 'simple', risk: 'low', modelTier: 'standard', workflow: false, finalReview: 'none', reasons: [], hardTriggers: [], contextProfile: 'full'},
        contextProfile: 'full', skillRoute: [], loadedAgentRoute: [], permissionMode: 'default', thinkingLevel: 'auto', modelMode: 'auto', providerBaseUrl: '',
        taskCompletionTaskId: 's2:task', taskCompletionTurnId: 'turn-active', taskCompletion: {phase: 'running'},
    }
    const queue = createTaskInputQueue({createId: () => 'generated'})
    const runtime = createTaskCommandRuntime({
        sessions: new Map([['s2', session]]), taskInputQueue: queue, sessionCoordinator: {setContextPolicy() {}}, IM_SOURCES: new Set(),
        log: {info() {}, warn() {}, error() {}, debug() {}}, loadCliSettings: () => ({env: {}, model: 'model-a'}), VALID_MODEL_MODES: new Set(['auto', 'fixed']), MODEL: 'model-a',
        decideTask: () => session.taskDecision, resolveTurnModelRoute: () => ({model: 'model-a', mode: 'auto', tier: 'standard'}), loadWfConfig: () => ({modelTiers: {}}), validateProviderModel: () => null,
        acceptSessionInput: (target, source, messageId, userId, taskDecision) => queue.accept(target, {source, messageId, userId, taskDecision}), rollbackSessionInput: (target, accepted) => queue.rollback(target, accepted),
        appendSessionEvent() {}, markVisibleSession: () => true, isUserSessionSource: () => false, createTaskCompletionState: value => value, createTurnIdentity: () => null,
        createTaskWorkflowGate: () => ({}), initializeTaskWorkbenchSession: async () => {}, userPreferences: {observe: () => []}, updateTaskState() {}, taskCompletionEventForClient() {},
        broadcast() {}, resolveSdkInputContent: async (_id, _session, content) => content, buildTaskPitfallReminder: () => '', routeSkills: () => [], createSessionContextEnvelope: () => ({}),
        resolveContextReusePolicy: () => ({mode: 'reuse', reasonCodes: [], cacheEligibility: 'unknown'}), resolveProviderCapabilityProfile: () => ({}), buildModelHandoffPrompt: ({prompt}) => prompt,
        beginTurn() {}, shouldCaptureTurnCheckpoint: () => false, closeSessionRuntime: async () => {}, startClaudeAgent: () => ({}), PushStream: class {}, loadAgentDefinitions: () => [],
        getMakeQueryOptions: () => async () => ({}), getStartStreamPump: () => () => {}, failPendingSessionInputs: () => 0, autoTriggerWorkflow: async () => {},
        armStreamWatchdog: (...args) => armed.push(args), updateTaskCompletion() {}, broadcastTaskLifecycle() {}, clearStreamWatchdog() {},
    })

    const result = await runtime.submitTaskCommand({sessionId: 's2', source: 'desktop', messageId: 'm2', content: '继续执行'})
    assert.equal(result.type, 'message_accepted')
    assert.equal(pushed.length, 1)
    assert.equal(armed.length, 1)
    assert.equal(armed[0][0], 's2')
    assert.equal(armed[0][2], session.query)
})

test('waiting_user 的下一条消息恢复原 Coordinator 并注入 AI，不创建重复任务', async () => {
    const pushed = []
    const journal = []
    const initialized = []
    const resumed = []
    const taskDecision = {version: 1, action: 'execute', complexity: 'simple', risk: 'low', modelTier: 'standard', workflow: false, finalReview: 'none', reasons: [], hardTriggers: [], contextProfile: 'full'}
    const session = {
        id: 's3', workDir: 'D:\\work', query: {}, pushStream: {push(value) { pushed.push(value) }},
        queryOpts: {model: 'model-a'}, _generating: false, activeTurnId: null, _pendingInputs: [],
        taskDecision, contextProfile: 'full', skillRoute: [], loadedAgentRoute: [], agentRoute: [],
        permissionMode: 'default', thinkingLevel: 'auto', modelMode: 'auto', providerBaseUrl: '',
        taskCompletionTaskId: 'old-task', taskCompletionTurnId: 'old-turn', coordinatorTaskId: 'old-task',
        taskCompletion: {phase: 'running'}, taskState: {status: 'running'},
    }
    const waiting = {taskId: 'old-task', turnId: 'old-turn', status: 'waiting_user', plan: {decision: taskDecision}}
    const queue = createTaskInputQueue({createId: () => 'continued-turn'})
    const runtime = createTaskCommandRuntime({
        sessions: new Map([['s3', session]]), taskInputQueue: queue, sessionCoordinator: {setContextPolicy() {}}, IM_SOURCES: new Set(),
        log: {info() {}, warn() {}, error() {}, debug() {}}, loadCliSettings: () => ({env: {}, model: 'model-a'}), VALID_MODEL_MODES: new Set(['auto', 'fixed']), MODEL: 'model-a',
        decideTask: () => taskDecision, resolveTurnModelRoute: () => ({model: 'model-a', mode: 'auto', tier: 'standard'}), loadWfConfig: () => ({modelTiers: {}}), validateProviderModel: () => null,
        acceptSessionInput: (target, source, messageId, userId, decision) => queue.accept(target, {source, messageId, userId, taskDecision: decision}), rollbackSessionInput: (target, accepted) => queue.rollback(target, accepted),
        appendSessionEvent: (_target, type, payload) => journal.push({type, payload}), markVisibleSession: () => true, isUserSessionSource: () => false,
        createTaskCompletionState: value => value, createTurnIdentity: () => null, createTaskWorkflowGate: () => ({}),
        initializeTaskWorkbenchSession: async value => initialized.push(value), getWaitingCoordinatorTask: () => waiting,
        resumeWaitingCoordinatorTask: () => { resumed.push('old-task'); return {...waiting, status: 'running'} },
        userPreferences: {observe: () => []}, updateTaskState: (target, _id, value) => { target.taskState = value }, taskCompletionEventForClient() {},
        broadcast() {}, resolveSdkInputContent: async (_id, _session, content) => content, buildTaskPitfallReminder: () => '', routeSkills: () => [], createSessionContextEnvelope: () => ({}),
        resolveContextReusePolicy: () => ({mode: 'reuse', reasonCodes: [], cacheEligibility: 'unknown'}), resolveProviderCapabilityProfile: () => ({}), buildModelHandoffPrompt: ({prompt}) => prompt,
        beginTurn() {}, shouldCaptureTurnCheckpoint: () => false, closeSessionRuntime: async () => {}, startClaudeAgent: () => ({}), PushStream: class {}, loadAgentDefinitions: () => [],
        getMakeQueryOptions: () => async () => ({}), getStartStreamPump: () => () => {}, failPendingSessionInputs: () => 0, autoTriggerWorkflow: async () => {},
        armStreamWatchdog() {}, updateTaskCompletion() {}, broadcastTaskLifecycle() {}, clearStreamWatchdog() {},
    })

    const result = await runtime.submitTaskCommand({sessionId: 's3', source: 'desktop', messageId: 'm3', content: '选择 A'})

    assert.equal(result.type, 'message_accepted')
    assert.deepEqual(resumed, ['old-task'])
    assert.equal(initialized.length, 0)
    assert.equal(session.taskCompletionTaskId, 'old-task')
    assert.equal(journal.some(event => event.type === 'task/input-appended' && event.payload.taskId === 'old-task'), true)
    assert.equal(journal.some(event => event.type === 'task/created'), false)
    assert.equal(pushed[0].message.content[0].text, '选择 A')
})

test('stopped 终态后的新文本创建新任务且不恢复旧 Coordinator', async () => {
    const journal = []
    const initialized = []
    const resumed = []
    const routed = []
    const taskDecision = {version: 1, action: 'execute', complexity: 'simple', risk: 'low', modelTier: 'standard', workflow: false, finalReview: 'none', reasons: [], hardTriggers: [], contextProfile: 'full'}
    const session = {
        id: 's4', workDir: 'D:\\work', query: {}, pushStream: {push() {}}, lastSessionId: 'sdk-s4',
        queryOpts: {model: 'model-a'}, _generating: false, activeTurnId: null, _pendingInputs: [],
        taskDecision, contextProfile: 'full', skillRoute: [], loadedAgentRoute: [], agentRoute: [],
        permissionMode: 'default', thinkingLevel: 'auto', modelMode: 'auto', providerBaseUrl: '',
        taskCompletionTaskId: 'old-task', taskCompletionTurnId: 'old-turn', coordinatorTaskId: 'old-task',
        taskCompletion: {phase: 'stopped'}, taskState: {status: 'stopped', resumable: true}, projectContext: {frameworks: ['Avalonia']},
    }
    const queue = createTaskInputQueue({createId: () => 'new-turn'})
    const runtime = createTaskCommandRuntime({
        sessions: new Map([['s4', session]]), taskInputQueue: queue, sessionCoordinator: {setContextPolicy() {}}, IM_SOURCES: new Set(),
        log: {info() {}, warn() {}, error() {}, debug() {}}, loadCliSettings: () => ({env: {}, model: 'model-a'}), VALID_MODEL_MODES: new Set(['auto', 'fixed']), MODEL: 'model-a',
        decideTask: () => taskDecision, resolveTurnModelRoute: () => ({model: 'model-a', mode: 'auto', tier: 'standard'}), loadWfConfig: () => ({modelTiers: {}}), validateProviderModel: () => null,
        acceptSessionInput: (target, source, messageId, userId, decision) => queue.accept(target, {source, messageId, userId, taskDecision: decision}), rollbackSessionInput: (target, accepted) => queue.rollback(target, accepted),
        appendSessionEvent: (_target, type, payload) => journal.push({type, payload}), markVisibleSession: () => true, isUserSessionSource: () => false,
        createTaskCompletionState: value => value, createTurnIdentity: () => null, createTaskWorkflowGate: () => ({}),
        initializeTaskWorkbenchSession: async value => initialized.push(value), getWaitingCoordinatorTask: () => null,
        resumeWaitingCoordinatorTask: () => { resumed.push('old-task'); return null },
        userPreferences: {observe: () => []}, updateTaskState: (target, _id, value) => { target.taskState = value }, taskCompletionEventForClient() {},
        broadcast() {}, resolveSdkInputContent: async (_id, _session, content) => `${content}\n历史 Pitfall: Vue 页面`, buildTaskPitfallReminder: () => '', routeSkills: input => { routed.push(input); return [] }, createSessionContextEnvelope: () => ({}),
        resolveContextReusePolicy: () => ({mode: 'reuse', reasonCodes: [], cacheEligibility: 'unknown'}), resolveProviderCapabilityProfile: () => ({}), buildModelHandoffPrompt: ({prompt}) => prompt,
        beginTurn() {}, shouldCaptureTurnCheckpoint: () => false, closeSessionRuntime: async () => {}, startClaudeAgent: () => ({}), PushStream: class {}, loadAgentDefinitions: () => [],
        getMakeQueryOptions: () => async () => ({}), getStartStreamPump: () => () => {}, failPendingSessionInputs: () => 0, autoTriggerWorkflow: async () => {},
        armStreamWatchdog() {}, updateTaskCompletion() {}, broadcastTaskLifecycle() {}, clearStreamWatchdog() {},
    })

    const result = await runtime.submitTaskCommand({sessionId: 's4', source: 'desktop', messageId: 'm4', content: '开始完全不同的新任务', taskText: '开始完全不同的新任务'})

    assert.equal(result.type, 'message_accepted')
    assert.deepEqual(resumed, [])
    assert.equal(initialized.length, 1)
    assert.notEqual(initialized[0].taskId, 'old-task')
    assert.match(initialized[0].taskId, /^s4:/)
    assert.equal(journal.some(event => event.type === 'task/created' && event.payload.taskId === initialized[0].taskId), true)
    assert.equal(journal.some(event => event.type === 'task/input-appended'), false)
    assert.equal(routed[0].text, '开始完全不同的新任务')
    assert.equal(routed[0].projectContext, session.projectContext)
})
