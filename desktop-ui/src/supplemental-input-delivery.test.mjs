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

test('忙碌时的补充指令直接提交 Gateway 队列，不在桌面端延后重派发', () => {
  const busyBranch = section('  if (taskBusy.value) {', '\n  const switchDecision =')
  assert.match(busyBranch, /const sent = await dispatch\(text, attachments, originalText\)/)
  assert.doesNotMatch(busyBranch, /msgQueue\.value\.push/)
})

test('补充指令不会重置同一父任务的完成收口和 Agent 活动状态', () => {
  const sendState = section('  // SIDE_EFFECT: 只有 WebSocket 接受消息后才提交本地回合状态。', '\n  const userMessage: Message =')
  assert.match(sendState, /if \(!wasTaskRunning\) \{\s*parentTaskUi\.value = createParentTaskUiState/s)
  assert.match(sendState, /if \(!wasTaskRunning\) \{\s*_pendingResultMessage = null/s)
  assert.match(sendState, /clearAgentRuns\(\)/)
})
