import test from 'node:test'
import assert from 'node:assert/strict'
import {runImTask} from './im-task-runner.mjs'

function fakeTaskCommands(result = {type: 'message_accepted', messageId: 'm1', turnId: 'turn-1', queuePosition: 0}) {
    let listener = null
    let disposed = false
    const cancellations = []
    return {
        submitTask: async command => ({...result, messageId: command.messageId || result.messageId}),
        observeTask: (_sessionId, _identity, next) => {
            listener = next
            return () => { disposed = true }
        },
        publish(event) { listener?.(event) },
        cancelTask: async (sessionId, identity) => { cancellations.push({sessionId, identity}) },
        get disposed() { return disposed },
        get cancellations() { return cancellations },
    }
}

test('IM runner 按 turnId 过滤并统一累积回复、工具计数和终态', async () => {
    const service = fakeTaskCommands()
    const finished = []
    const running = runImTask({
        taskCommands: service, sessionId: 's1', source: 'wechat', userId: 'u1', content: '修复', messageId: 'm1',
        completionDelayMs: 0,
        onFinish: result => finished.push(result),
    })
    await Promise.resolve()
    service.publish({type: 'text_delta', turnId: 'other', text: '错误回合'})
    service.publish({type: 'tool_use_start', turnId: 'turn-1', tool_name: 'Read'})
    service.publish({type: 'text_delta', turnId: 'turn-1', text: '完成'})
    service.publish({type: 'task_completed', turnId: 'turn-1', notificationId: 'n1'})
    const result = await running

    assert.equal(result.reason, 'task_completed')
    assert.equal(result.toolCount, 1)
    assert.equal(finished[0].replyText, '完成')
    assert.equal(finished[0].notificationId, 'n1')
    assert.equal(service.disposed, true)
})

test('IM runner 对重复和拒绝结果立即收口且不重复提交', async () => {
    for (const [submission, reason] of [
        [{type: 'message_duplicate', messageId: 'm1'}, 'duplicate'],
        [{type: 'message_rejected', code: 'input_queue_full'}, 'queue_full'],
    ]) {
        const service = fakeTaskCommands(submission)
        let finishReason = null
        const result = await runImTask({
            taskCommands: service, sessionId: 's1', source: 'feishu', userId: 'u1', content: '继续', messageId: 'm1',
            onFinish: value => { finishReason = value.reason },
        })
        assert.equal(result.reason, reason)
        assert.equal(finishReason, reason)
        assert.equal(service.disposed, true)
    }
})

test('IM runner 在适配器停止时释放 observer', async () => {
    const service = fakeTaskCommands()
    const controller = new AbortController()
    const running = runImTask({
        taskCommands: service, sessionId: 's1', source: 'dingtalk', userId: 'u1', content: '继续',
        signal: controller.signal,
    })
    controller.abort()
    const result = await running
    assert.equal(result.reason, 'adapter_stopped')
    assert.equal(service.disposed, true)
})

test('IM runner 提交期间适配器停止会取消随后才 accepted 的孤儿任务', async () => {
    let resolveSubmission
    const service = fakeTaskCommands()
    service.submitTask = () => new Promise(resolve => { resolveSubmission = resolve })
    const controller = new AbortController()
    const running = runImTask({
        taskCommands: service, sessionId: 's1', source: 'dingtalk', userId: 'u1', content: '继续',
        signal: controller.signal,
    })
    await Promise.resolve()
    controller.abort()
    resolveSubmission({type: 'message_accepted', messageId: 'm1', turnId: 'turn-late', queuePosition: 0})

    const result = await running
    assert.equal(result.reason, 'adapter_stopped')
    assert.deepEqual(service.cancellations, [{
        sessionId: 's1',
        identity: {source: 'dingtalk', userId: 'u1', reason: 'im_adapter_stopped_after_submit'},
    }])
})

test('IM runner 可直接消费 task_completed.reply 作为最终回复', async () => {
    const service = fakeTaskCommands()
    const running = runImTask({
        taskCommands: service, sessionId: 's1', source: 'wechat', userId: 'u1', content: '查询', messageId: 'm1',
        completionDelayMs: 0,
    })
    await Promise.resolve()
    service.publish({type: 'task_completed', turnId: 'turn-1', reply: '完整终态回复', notificationId: 'n2'})
    const result = await running
    assert.equal(result.reason, 'task_completed')
    assert.equal(result.replyText, '完整终态回复')
})

test('IM runner 将验证不足作为可继续终态，不等待超时', async () => {
    const service = fakeTaskCommands()
    const finished = []
    const running = runImTask({
        taskCommands: service, sessionId: 's1', source: 'wechat', userId: 'u1', content: '验证', messageId: 'm1',
        onFinish: result => finished.push(result),
    })
    await Promise.resolve()
    service.publish({
        type: 'task_verification_inconclusive', turnId: 'turn-1',
        detail: '只完成构建，尚未执行测试', notificationId: 'n3',
    })
    const result = await running
    assert.equal(result.reason, 'task_verification_inconclusive')
    assert.match(finished[0].replyText, /只完成构建，尚未执行测试/)
    assert.equal(finished[0].notificationId, 'n3')
    assert.equal(service.disposed, true)
})

test('IM 回合超时先取消后台任务再释放 observer', async () => {
    const service = fakeTaskCommands()
    let timeoutCallback = null
    const running = runImTask({
        taskCommands: service, sessionId: 's1', source: 'wechat', userId: 'u1', content: '执行',
        timeoutOptions: {
            setTimer: callback => { timeoutCallback = callback; return {unref() {}} },
            clearTimer() {},
        },
    })
    await Promise.resolve()
    timeoutCallback()
    const result = await running
    assert.equal(result.reason, 'timeout')
    assert.deepEqual(service.cancellations, [{
        sessionId: 's1',
        identity: {source: 'wechat', userId: 'u1', reason: 'im_timeout'},
    }])
    assert.equal(service.disposed, true)
})
