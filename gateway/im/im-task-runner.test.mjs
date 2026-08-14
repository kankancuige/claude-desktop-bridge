import test from 'node:test'
import assert from 'node:assert/strict'
import {runImTask} from './im-task-runner.mjs'

function fakeTaskCommands(result = {type: 'message_accepted', messageId: 'm1', turnId: 'turn-1', queuePosition: 0}) {
    let listener = null
    let disposed = false
    return {
        submitTask: async command => ({...result, messageId: command.messageId || result.messageId}),
        observeTask: (_sessionId, _identity, next) => {
            listener = next
            return () => { disposed = true }
        },
        publish(event) { listener?.(event) },
        get disposed() { return disposed },
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
