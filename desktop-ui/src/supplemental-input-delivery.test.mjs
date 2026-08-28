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

test('后台会话收到 AskUserQuestion 时保留问题和选项，切回前台可恢复选择横幅', () => {
  const snapshotSection = section('        // 后台 tab 也必须保存待确认内容', "        const snapshotStatus =")
  assert.doesNotMatch(snapshotSection, /if \(fg && Array\.isArray\(msg\.pendingConfirmations\)/)
  assert.match(snapshotSection, /Array\.isArray\(pending\.questions\)/)
  assert.match(snapshotSection, /questions,/)

  const choiceSection = section("      case 'choice_request':", "      case 'confirmation_resolved':")
  assert.doesNotMatch(choiceSection, /if \(!fg\) break/)
  assert.match(choiceSection, /msg\.questions\.map/)
  assert.match(choiceSection, /questions,/)
  assert.match(snapshotSection, /else if \(!pending && \(pendingChoice\.value \|\| pendingPermission\.value\)\)/)
  assert.match(snapshotSection, /pendingChoice\.value = null/)
})

test('确认响应等待 Gateway 回执，且重复 requestId 不会再次弹窗', () => {
  const choiceSection = section("      case 'choice_request':", "      case 'confirmation_response':")
  const snapshotSection = section('        // 后台 tab 也必须保存待确认内容', "        const snapshotStatus =")
  assert.match(choiceSection, /resolvedConfirmationIds\.value\.has/)
  assert.match(source, /confirmationSubmitting\.value = c\.requestId/)
  assert.match(snapshotSection, /confirmationSubmitting\.value = null/)
  assert.match(source, /answerKey: String\(q\?\.answerKey \|\| `q-\$\{index\}`\)/)
  assert.match(source, /case 'confirmation_response':/)
  assert.match(source, /确认已提交，等待 AI 返回进度/)
})

test('AskUserQuestion 展示全部问题并在答案齐全后一次提交 answers', () => {
  assert.match(source, /v-for="\(question, questionIndex\) in pendingChoice\.questions"/)
  const responder = section('function respondChoice(questionIndex: number, optionIndex: number)', '/** 保存当前问题的自定义答案')
  assert.match(responder, /Object\.keys\(c\.answers\)\.length < c\.questions\.length/)
  assert.match(responder, /answers: c\.answers/)
  assert.doesNotMatch(responder, /questionIndex:\s*0/)
})
