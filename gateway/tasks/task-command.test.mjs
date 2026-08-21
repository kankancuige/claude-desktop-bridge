import test from 'node:test'
import assert from 'node:assert/strict'
import {createTaskCommandService, normalizeTaskCommand} from './task-command.mjs'

test('normalizeTaskCommand 保留受控字段并拒绝非法输入', () => {
    assert.deepEqual(normalizeTaskCommand({
        sessionId: 'session-1', source: 'desktop', messageId: 'message-1', content: ' 修复按钮 ',
        permissionMode: 'acceptEdits', thinkingLevel: 'high', modelMode: 'auto', modelMeta: {contextWindow: 256000}, contextSwitchMode: 'handoff_summary', hasAttachments: true,
    }), {
        sessionId: 'session-1', source: 'desktop', userId: null, messageId: 'message-1', content: ' 修复按钮 ',
        taskText: null, permissionMode: 'acceptEdits', thinkingLevel: 'high', modelMode: 'auto', model: null,
        modelMeta: {contextWindow: 256000}, contextSwitchMode: 'handoff_summary',
        hasAttachments: true, noWorkflow: false,
    })

    for (const input of [
        {sessionId: '', source: 'desktop', content: 'x'},
        {sessionId: 's', source: 'unknown', content: 'x'},
        {sessionId: 's', source: 'desktop', content: '   '},
        {sessionId: 's', source: 'desktop', content: 'x', permissionMode: 'root'},
        {sessionId: 's', source: 'desktop', content: 'x', contextSwitchMode: 'cancel'},
    ]) {
        assert.throws(() => normalizeTaskCommand(input), error => error?.code === 'INVALID_TASK_COMMAND')
    }
})

test('TaskCommandService 统一提交和取消调用', async () => {
    const calls = []
    const service = createTaskCommandService({
        submit: async command => {
            calls.push(['submit', command])
            return {ok: true, messageId: command.messageId, turnId: 'turn-1'}
        },
        cancel: async (sessionId, request) => {
            calls.push(['cancel', sessionId, request])
            return {stopped: true}
        },
    })

    const submitted = await service.submitTask({sessionId: 'session-1', source: 'wechat', userId: 'u1', messageId: 'm1', content: '继续'})
    assert.deepEqual(submitted, {ok: true, messageId: 'm1', turnId: 'turn-1'})
    assert.equal(calls[0][1].source, 'wechat')
    assert.deepEqual(await service.cancelTask('session-1', {source: 'desktop'}), {stopped: true})
})

test('observer 只接收所属 Session 和 IM 身份事件，desktop 可观察全部来源', () => {
    const service = createTaskCommandService({submit: async () => ({ok: true}), cancel: async () => ({stopped: true})})
    const desktop = []
    const userA = []
    const userB = []
    const disposeDesktop = service.observeTask('session-1', {source: 'desktop'}, event => desktop.push(event.type))
    const disposeA = service.observeTask('session-1', {source: 'wechat', userId: 'a'}, event => userA.push(event.type))
    service.observeTask('session-1', {source: 'wechat', userId: 'b'}, event => userB.push(event.type))

    assert.equal(service.publish('session-1', {type: 'task_started'}, {source: 'wechat', userId: 'a'}), 2)
    assert.equal(service.publish('session-2', {type: 'task_started'}, {source: 'wechat', userId: 'a'}), 0)
    assert.deepEqual(desktop, ['task_started'])
    assert.deepEqual(userA, ['task_started'])
    assert.deepEqual(userB, [])

    disposeDesktop()
    disposeDesktop()
    assert.equal(service.publish('session-1', {type: 'task_completed'}, null), 0)
})

test('listener 异常不阻断其他 observer，dispose 后拒绝新操作', async () => {
    const errors = []
    const received = []
    const service = createTaskCommandService({
        submit: async () => ({ok: true}), cancel: async () => ({stopped: true}),
        onListenerError: error => errors.push(error.message),
    })
    service.observeTask('session-1', {source: 'desktop'}, () => { throw new Error('listener failed') })
    service.observeTask('session-1', {source: 'desktop'}, event => received.push(event.type))
    assert.equal(service.publish('session-1', {type: 'progress'}, null), 1)
    assert.deepEqual(errors, ['listener failed'])
    assert.deepEqual(received, ['progress'])

    service.dispose()
    service.dispose()
    await assert.rejects(service.submitTask({sessionId: 'session-1', source: 'desktop', content: 'x'}), error => error?.code === 'TASK_COMMAND_SERVICE_CLOSED')
    assert.throws(() => service.observeTask('session-1', {source: 'desktop'}, () => {}), error => error?.code === 'TASK_COMMAND_SERVICE_CLOSED')
})
