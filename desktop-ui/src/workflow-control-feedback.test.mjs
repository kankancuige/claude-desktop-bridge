import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'

const source = readFileSync(new URL('./views/WorkspaceView.vue', import.meta.url), 'utf8')

test('Workflow 重连快照使用服务端 Agent 状态且支持多 Workflow', () => {
    assert.match(source, /case 'workflow_states_snapshot'/)
    assert.match(source, /const status = normalizeWorkflowAgentStatus\(ag\.status\)/)
    assert.doesNotMatch(source.slice(source.indexOf("case 'workflow_states_snapshot'"), source.indexOf("case 'workflow_started'")), /status: 'running'/)
})

test('非当前 Workflow 的恢复和失败事件不会改写当前面板', () => {
    for (const [start, end] of [
        ["case 'workflow_resumed'", "case 'workflow_phase'"],
        ["case 'workflow_error'", "case 'agent_paused'"],
        ["case 'agent_paused'", "case 'agent_resumed'"],
        ["case 'agent_resumed'", "case 'nudge'"],
    ]) {
        const from = source.indexOf(start)
        const to = source.indexOf(end, from + start.length)
        assert.ok(from >= 0 && to > from)
        assert.match(source.slice(from, to), /matchesCurrentWorkflow\(msg\)/)
    }
})

test('Workflow 暂停收敛到主任务入口且提交操作检查 response.ok', () => {
    const from = source.indexOf('async function stopWf')
    const to = source.indexOf('// ── 消息气泡操作', from)
    assert.ok(from >= 0 && to > from)
    const controls = source.slice(from, to)
    assert.match(controls, /if \(mode === 'pause'\) \{\s*await cancelTask\(\)/)
    assert.match(controls, /requireOkResponse\(/)
    assert.doesNotMatch(source, /async function resumeWf/)
    assert.doesNotMatch(source, /async function resumeAgent/)
})

test('权限模式切换等待服务端确认且发送失败时恢复旧值', () => {
    const watcherStart = source.indexOf('watch(permissionMode')
    const watcherEnd = source.indexOf('// ═══════════════════════════════════════════', watcherStart)
    assert.ok(watcherStart >= 0 && watcherEnd > watcherStart)
    const watcher = source.slice(watcherStart, watcherEnd)
    assert.match(watcher, /if \(hasSession && !sendSessionPayload\(\{type: 'setting_change', permissionMode: newVal\}\)\)/)
    assert.match(watcher, /permissionMode\.value = oldVal/)
    assert.match(source, /case 'setting_changed'/)
    assert.match(source, /resolvedRequestIds/)
})
