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

test('Workflow 和 Agent 控制操作都检查 response.ok', () => {
    for (const [start, end] of [
        ['async function stopWf', 'async function resumeWf'],
        ['async function resumeWf', 'async function stopAgent'],
        ['async function stopAgent', 'async function resumeAgent'],
        ['async function resumeAgent', '// ──'],
    ]) {
        const from = source.indexOf(start)
        const to = source.indexOf(end, from + start.length)
        assert.ok(from >= 0 && to > from)
        assert.match(source.slice(from, to), /requireOkResponse\(/)
    }
})
