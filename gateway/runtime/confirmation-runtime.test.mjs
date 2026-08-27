import test from 'node:test'
import assert from 'node:assert/strict'
import {createConfirmationRuntime, normalizeChoiceQuestions} from './confirmation-runtime.mjs'

test('confirmation runtime settles pending entries idempotently', async () => {
    const sessions = new Map([['s', {pending: new Map(), clients: new Set(), mirrors: {}}]])
    const sent = []
    const hooks = []
    const runtime = createConfirmationRuntime({
        sessions,
        getConfirmHooks: () => hooks,
        broadcastTurn: (...args) => sent.push(args),
        broadcast: () => {},
        shouldRouteMirror: () => true,
    })
    let resolved = 0
    sessions.get('s').pending.set('r', {type: 'permission', toolName: 'Edit', resolve: () => { resolved++ }, settled: false})
    runtime.settlePending('s', 'r', {behavior: 'allow'}, 'desktop')
    runtime.settlePending('s', 'r', {behavior: 'deny'}, 'timeout')
    assert.equal(resolved, 1)
    assert.equal(sent[0][1].type, 'confirmation_resolved')
})

test('并发确认结算后向桌面端重新发布下一条 pending', () => {
    const session = {pending: new Map(), clients: new Set(), mirrors: {}}
    const desktop = []
    const runtime = createConfirmationRuntime({
        sessions: new Map([['s', session]]), broadcastTurn: () => {}, broadcast: () => {},
        broadcastDesktop: (_sessionId, event) => desktop.push(event), shouldRouteMirror: () => true,
    })
    session.pending.set('r1', {id: 'r1', type: 'permission', toolName: 'Read', input: {}, resolve() {}, settled: false})
    session.pending.set('r2', {id: 'r2', type: 'choice', toolName: 'AskUserQuestion', input: {}, questions: [{question: '继续？', options: [{label: '是'}]}], resolve() {}, settled: false})
    runtime.settlePending('s', 'r1', {behavior: 'allow'}, 'desktop')
    assert.equal(session.pending.has('r2'), true)
    assert.deepEqual(desktop, [{
        type: 'choice_request', requestId: 'r2', toolName: 'AskUserQuestion',
        questions: [{question: '继续？', options: [{label: '是'}]}], turnId: undefined,
    }])
})

test('confirmation runtime maps choice and permission decisions', () => {
    const runtime = createConfirmationRuntime({sessions: new Map(), broadcastTurn: () => {}, broadcast: () => {}, shouldRouteMirror: () => true})
    const choice = {type: 'choice', input: {questions: [{question: '继续吗？', options: [{label: '继续'}]}]}, questions: [{question: '继续吗？', options: [{label: '继续'}]}]}
    assert.deepEqual(runtime.decisionToResult(choice, null, 0, 0), {
        behavior: 'allow',
        updatedInput: {questions: [{question: '继续吗？', options: [{label: '继续'}]}], answers: {'继续吗？': '继续'}},
    })
    assert.deepEqual(runtime.decisionToResult({type: 'permission', input: {path: 'a'}}, 'allow'), {behavior: 'allow', updatedInput: {path: 'a'}})
})

test('多问题确认未完成时不生成终态结果，逐题答案可累积到完整提交', () => {
    const runtime = createConfirmationRuntime({sessions: new Map(), broadcastTurn: () => {}, broadcast: () => {}, shouldRouteMirror: () => true})
    const entry = {
        type: 'choice',
        input: {questions: [
            {question: '环境？', options: [{label: '测试'}]},
            {question: '范围？', options: [{label: '全部'}]},
        ]},
        questions: [
            {question: '环境？', options: [{label: '测试'}]},
            {question: '范围？', options: [{label: '全部'}]},
        ],
    }
    const first = runtime.decisionToResult(entry, null, 0, 0)
    assert.equal(first.incomplete, true)
    assert.deepEqual(first.answers, {'环境？': '测试'})
    entry.input.answers = first.answers
    const complete = runtime.decisionToResult(entry, null, 0, 1)
    assert.deepEqual(complete, {
        behavior: 'allow',
        updatedInput: {
            questions: entry.questions,
            answers: {'环境？': '测试', '范围？': '全部'},
        },
    })
})

test('桌面一次提交完整 answers 才允许 AskUserQuestion 继续', () => {
    const runtime = createConfirmationRuntime({sessions: new Map(), broadcastTurn: () => {}, broadcast: () => {}, shouldRouteMirror: () => true})
    const entry = {
        type: 'choice',
        input: {questions: [{question: '一', options: [{label: 'A'}]}, {question: '二', options: [{label: 'B'}]}]},
        questions: [{question: '一', options: [{label: 'A'}]}, {question: '二', options: [{label: 'B'}]}],
    }
    assert.equal(runtime.decisionToResult(entry, null, null, null, null, {'一': 'A'}).incomplete, true)
    assert.deepEqual(runtime.decisionToResult(entry, null, null, null, null, {'一': 'A', '二': 'B'}), {
        behavior: 'allow', updatedInput: {...entry.input, answers: {'一': 'A', '二': 'B'}},
    })
})

test('确认结果会释放 canUseTool Promise，SDK 可继续下一轮', async () => {
    const sessions = new Map([['s', {pending: new Map(), clients: new Set(), mirrors: {}, permissionMode: 'default'}]])
    const sent = []
    const runtime = createConfirmationRuntime({
        sessions, broadcastTurn: (...args) => sent.push(args), broadcast: () => {}, shouldRouteMirror: () => true,
        timeoutMs: 10_000,
    })
    const resultPromise = runtime.makeCanUseTool('s')('AskUserQuestion', {
        questions: [{question: '继续吗？', options: [{label: '继续'}]}],
    })
    const request = sent.find(args => args[1]?.type === 'choice_request')?.[1]
    assert.ok(request?.requestId)
    assert.equal(sessions.get('s').pending.size, 1)
    runtime.settlePending('s', request.requestId, runtime.decisionToResult(
        sessions.get('s').pending.get(request.requestId), null, 0, 0,
    ), 'desktop')
    assert.deepEqual(await resultPromise, {
        behavior: 'allow',
        updatedInput: {
            questions: [{question: '继续吗？', options: [{label: '继续'}]}],
            answers: {'继续吗？': '继续'},
        },
    })
    assert.equal(sessions.get('s').pending.size, 0)
})

test('Gateway Runtime 重建后确认 requestId 仍保持唯一', () => {
    const createRuntime = requestNamespace => {
        const sessions = new Map([['s', {pending: new Map(), clients: new Set(), mirrors: {}, permissionMode: 'default'}]])
        const sent = []
        const runtime = createConfirmationRuntime({
            sessions, broadcastTurn: (_sessionId, event) => sent.push(event), broadcast: () => {},
            shouldRouteMirror: () => true, requestNamespace, timeoutMs: 20,
        })
        void runtime.makeCanUseTool('s')('Bash', {command: 'pwd'})
        return sent.find(event => event.type === 'permission_request')?.requestId
    }
    assert.notEqual(createRuntime('gateway-a'), createRuntime('gateway-b'))
})

test('已 abort 的确认不会进入 pending 并立即拒绝', async () => {
    const controller = new AbortController()
    controller.abort()
    const session = {pending: new Map(), clients: new Set(), mirrors: {}, permissionMode: 'default'}
    const sent = []
    const runtime = createConfirmationRuntime({
        sessions: new Map([['s', session]]), broadcastTurn: (_sessionId, event) => sent.push(event),
        broadcast: () => {}, shouldRouteMirror: () => true, timeoutMs: 20,
    })
    const result = await runtime.makeCanUseTool('s')('Bash', {}, {signal: controller.signal})
    assert.deepEqual(result, {behavior: 'deny', message: '已取消', interrupt: true})
    assert.equal(session.pending.size, 0)
    assert.equal(sent.some(event => event.type === 'permission_request'), false)
})

test('相同 toolUseID 的重复回调复用同一确认并一起结算', async () => {
    const session = {pending: new Map(), clients: new Set(), mirrors: {}, permissionMode: 'default'}
    const sent = []
    const runtime = createConfirmationRuntime({
        sessions: new Map([['s', session]]), broadcastTurn: (_sessionId, event) => sent.push(event),
        broadcast: () => {}, shouldRouteMirror: () => true,
    })
    const canUseTool = runtime.makeCanUseTool('s')
    const first = canUseTool('Bash', {command: 'pwd'}, {toolUseID: 'tool-1'})
    const second = canUseTool('Bash', {command: 'pwd'}, {toolUseID: 'tool-1'})
    assert.equal(session.pending.size, 1)
    assert.equal(sent.filter(event => event.type === 'permission_request').length, 1)
    const [entry] = session.pending.values()
    runtime.settlePending('s', entry.id, {behavior: 'allow', updatedInput: entry.input}, 'desktop')
    assert.equal((await first).behavior, 'allow')
    assert.equal((await second).behavior, 'allow')
})

test('重复或空问题使用稳定索引收集答案并生成唯一问题文本', () => {
    const runtime = createConfirmationRuntime({sessions: new Map(), broadcastTurn: () => {}, broadcast: () => {}, shouldRouteMirror: () => true})
    const rawQuestions = [
        {question: '选择环境？', header: '环境一', options: [{label: 'A'}]},
        {question: '选择环境？', header: '环境二', options: [{label: 'B'}]},
        {question: '', header: '范围', options: [{label: '全部'}]},
    ]
    const entry = {
        type: 'choice',
        input: {questions: rawQuestions},
        questions: normalizeChoiceQuestions(rawQuestions),
    }
    const result = runtime.decisionToResult(entry, null, null, null, null, {'q-0': 'A', 'q-1': 'B', 'q-2': '全部'})
    assert.deepEqual(result.updatedInput.answers, {
        '选择环境？': 'A',
        '选择环境？ (2)': 'B',
        '范围': '全部',
    })
})
