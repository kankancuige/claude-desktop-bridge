import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'

const source = readFileSync(new URL('./views/WorkspaceView.vue', import.meta.url), 'utf8')

function section(start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  assert.ok(from >= 0, `未找到代码段起点: ${start}`)
  assert.ok(to > from, `未找到代码段终点: ${end}`)
  return source.slice(from, to)
}

test('暂停后保留中断恢复草稿，但不把旧任务回填输入框', () => {
  const stopHandler = section('async function cancelTask()', '// ── 双通道权限确认响应')
  assert.match(stopHandler, /saveDraftForTab\(activeTab\.value, pausedTaskText, true\)/)
  assert.match(stopHandler, /inputText\.value = ''/)
  assert.match(stopHandler, /pendingAttachments\.value = \[\]/)
  assert.doesNotMatch(stopHandler, /inputText\.value = lastUserMessage/)
  assert.doesNotMatch(stopHandler, /pendingAttachments\.value = \[\.\.\.restoredAttachments\.values\(\)\]/)
  assert.match(stopHandler, /ws\.taskPaused/)
})

test('输入框主按钮按 pause、continue、send 三态渲染', () => {
  const composer = section('<div class="input-wrapper">', '右侧文件面板 (File Panel)')
  assert.match(composer, /composerTaskAction === 'pause'/)
  assert.match(composer, /composerTaskAction === 'continue'/)
  assert.match(composer, /@click="continuePausedTask"/)
  assert.match(composer, /@click="sendMessage"/)
  assert.doesNotMatch(source, /class="task-continue-btn"/)

  const continueButton = section('v-else-if="composerTaskAction === \'continue\'"', '</button>')
  assert.match(continueButton, /<svg[^>]*aria-hidden="true"/)
  assert.match(continueButton, /<path d="M8 5v14l11-7z"\/>/)
  assert.doesNotMatch(continueButton, /\{\{\s*t\('ws\.resumeTask'\)\s*\}\}/)
})

test('继续暂停任务从当前会话中断草稿取原任务', () => {
  const continuation = section('async function continuePausedTask()', 'const stoppingTask = ref(false)')
  assert.match(continuation, /getInterruptedTaskText\(activeTab\.value\)/)
  assert.match(continuation, /buildContinuationPrompt/)
  assert.match(continuation, /doSend\(t\('ws\.continueTask'\)/)
})

test('可继续任务不会在生命周期终态自动 flush 队列', () => {
  const guard = section('function canAutoFlushQueue(', 'function currentActivityMessage')
  assert.match(guard, /taskState\?\.resumable !== true/)
  assert.match(guard, /lifecycle\.canContinue !== true/)
  const lifecycle = section("case 'session_lifecycle_snapshot'", "case 'session_state_snapshot'")
  assert.match(lifecycle, /canAutoFlushQueue\(\)/)
  const terminal = section("case 'task_reviewing'", "case 'generation_stopped'")
  assert.match(terminal, /canAutoFlushQueue\(\)/)
  const error = section("case 'stream_error'", "case 'subagent_spawning'")
  assert.match(error, /canAutoFlushQueue\(\)/)
})

test('Workflow 和 Agent 不再提供独立恢复入口', () => {
  assert.doesNotMatch(source, /async function resumeWf\(/)
  assert.doesNotMatch(source, /async function resumeAgent\(/)
  assert.doesNotMatch(source, /@click="resumeWf\(/)
  assert.doesNotMatch(source, /@click="resumeAgent\(/)
})

test('连接中断立即投影为可继续状态且不保留自动重发入口', () => {
  const reconnect = section('function projectSessionInterruption', '// ── Workflow 停止/恢复/提交')
  assert.match(reconnect, /status: 'interrupted'/)
  assert.match(reconnect, /resumable: true/)
  assert.match(reconnect, /pendingInputTexts\.delete\(messageId\)/)
  assert.doesNotMatch(source, /function resendPendingInputs/)
  assert.doesNotMatch(source, /resendPendingInputs\(/)

  const sessionSocket = section('async function connectWS(', '// ── Workflow 停止/恢复/提交')
  const closeStart = sessionSocket.indexOf('thisWs.onclose = (event) =>')
  const errorStart = sessionSocket.indexOf('thisWs.onerror = () =>', closeStart)
  assert.ok(closeStart >= 0)
  assert.ok(errorStart > closeStart)
  const closeHandler = sessionSocket.slice(closeStart, errorStart)
  assert.match(closeHandler, /projectSessionInterruption\(tab/)
  const errorHandler = sessionSocket.slice(errorStart)
  assert.match(errorHandler, /projectSessionInterruption\(tab/)
})
