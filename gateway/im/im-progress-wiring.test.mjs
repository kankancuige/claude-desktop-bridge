import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'

const indexSource = [
    readFileSync(new URL('../gateway-runtime-impl.mjs', import.meta.url), 'utf8'),
    readFileSync(new URL('../runtime/im-runtime.mjs', import.meta.url), 'utf8'),
    readFileSync(new URL('../runtime/task-completion-event-runtime.mjs', import.meta.url), 'utf8'),
    readFileSync(new URL('../runtime/session-broadcast-runtime.mjs', import.meta.url), 'utf8'),
    readFileSync(new URL('../runtime/task-lifecycle-runtime.mjs', import.meta.url), 'utf8'),
    readFileSync(new URL('../runtime/workflow-broadcast-runtime.mjs', import.meta.url), 'utf8'),
].join('\n')
const completionEventSource = readFileSync(new URL('../runtime/task-completion-event-runtime.mjs', import.meta.url), 'utf8')
const runnerSource = readFileSync(new URL('./im-task-runner.mjs', import.meta.url), 'utf8')
const adapterSources = ['wechat.mjs', 'feishu.mjs', 'dingtalk.mjs']
    .map(file => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'))

test('桌面回合与 Workflow 广播共用统一 IM progress reporter', () => {
    assert.match(indexSource, /function broadcastTurn[\s\S]*?reportImProgressEvent\(sessionId, message, identity\)/)
    assert.match(indexSource, /function broadcastWorkflowEvent[\s\S]*?reportImProgressEvent\?\.\(sessionId, message, session\?\.taskCompletionIdentity \|\| null\)/)
})

test('旧的逐工具通知出口已移除', () => {
    assert.doesNotMatch(indexSource, /maybeMirrorProgress/)
    assert.doesNotMatch(runnerSource, /onTool/)
    assert.doesNotMatch(runnerSource, /onResult/)
    for (const source of adapterSources) {
        assert.doesNotMatch(source, /onTool\s*:/)
        assert.doesNotMatch(source, /onResult\s*:/)
        assert.doesNotMatch(source, /共执行\s*\$?\{?toolCount/)
    }
})

test('三种 IM 适配器都显示确认编号、拒绝歧义回复并通知跨通道结算', () => {
    for (const source of adapterSources) {
        assert.match(source, /pendingConfirm\.matchReply\(uid, text\)/)
        assert.match(source, /confirmMatch\.reason === 'ambiguous'/)
        assert.match(source, /added\.entry\.replyToken/)
        assert.match(source, /added\.reason\?\.endsWith\('capacity'\)/)
        assert.match(source, /function onConfirmResolved\(sessionId, requestId, resolution = \{\}\)/)
        assert.match(source, /该确认已由桌面端或其他通道处理/)
    }
})

test('验证不足使用稳定任务投影和可重试终态通知 ID', () => {
    assert.match(indexSource, /type === 'task_verification_inconclusive'[\s\S]*?taskStateForInconclusive/)
    assert.match(indexSource, /task_verification_inconclusive\)\$\//)
    assert.match(completionEventSource, /async function publishVerificationInconclusive[\s\S]*?maybeMirror(?:\?\.)?\([\s\S]*?:task_verification_inconclusive/)
    assert.equal((indexSource + readFileSync(new URL('../runtime/task-completion-effects-runtime.mjs', import.meta.url), 'utf8')).match(/await publishVerificationInconclusive\(/g)?.length || 0, 3)
})

test('直接 IM 来源的确定性通知意图在完成门禁前写入任务投影', () => {
    assert.match(indexSource, /function requiredTaskNotificationPlatforms[\s\S]*?resolveRequiredNotificationPlatforms/)
    assert.match(indexSource, /function taskStateWithNotificationIntents[\s\S]*?state: 'pending'/)
    assert.match(indexSource, /taskStateWithNotificationIntents\(session, nextState, /)
    assert.match(indexSource + completionEventSource, /task_verification_inconclusive[\s\S]*?taskStateWithNotificationIntents\(session, nextState, `\$\{taskId\}:\$\{type\}`\)/)
})
