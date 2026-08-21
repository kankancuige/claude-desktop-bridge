import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'

const indexSource = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
const runnerSource = readFileSync(new URL('./im-task-runner.mjs', import.meta.url), 'utf8')
const adapterSources = ['wechat.mjs', 'feishu.mjs', 'dingtalk.mjs']
    .map(file => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'))

test('桌面回合与 Workflow 广播共用统一 IM progress reporter', () => {
    assert.match(indexSource, /function broadcastTurn[\s\S]*?reportImProgressEvent\(sid, msg, identity\)/)
    assert.match(indexSource, /function broadcastWorkflowEvent[\s\S]*?reportImProgressEvent\(sid, msg, session\?\.taskCompletionIdentity \|\| null\)/)
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

test('验证不足使用稳定任务投影和可重试终态通知 ID', () => {
    assert.match(indexSource, /type === 'task_verification_inconclusive'[\s\S]*?taskStateForInconclusive/)
    assert.match(indexSource, /task_verification_inconclusive\)\$\//)
    assert.match(indexSource, /async function publishVerificationInconclusive[\s\S]*?maybeMirror\([\s\S]*?:task_verification_inconclusive/)
    assert.equal((indexSource.match(/await publishVerificationInconclusive\(/g) || []).length, 3)
})

test('直接 IM 来源的确定性通知意图在完成门禁前写入任务投影', () => {
    assert.match(indexSource, /function requiredTaskNotificationPlatforms[\s\S]*?resolveRequiredNotificationPlatforms/)
    assert.match(indexSource, /function taskStateWithNotificationIntents[\s\S]*?state: 'pending'/)
    assert.match(indexSource, /nextState = taskStateWithNotificationIntents\(session, nextState, notificationId\)/)
    assert.match(indexSource, /task_verification_inconclusive'[\s\S]*?taskStateWithNotificationIntents\(s, nextState, `\$\{taskId\}:\$\{type\}`\)/)
})
