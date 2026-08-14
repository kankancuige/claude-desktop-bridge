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
