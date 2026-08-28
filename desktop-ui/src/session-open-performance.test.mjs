import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'

const source = readFileSync(new URL('./views/WorkspaceView.vue', import.meta.url), 'utf8')
const sessionCreateSection = source.slice(
  source.indexOf('async function _doHandleNewSession('),
  source.indexOf('/** IM 控制命令处理', source.indexOf('async function _doHandleNewSession(')),
)
const switchTabSection = source.slice(
  source.indexOf('async function switchToTab('),
  source.indexOf('async function focusSessionForIm(', source.indexOf('async function switchToTab(')),
)

test('创建新会话后项目扫描在后台执行，不阻塞 connecting 状态收口', () => {
  assert.ok(sessionCreateSection.length > 0, '未找到会话创建流程')
  assert.match(sessionCreateSection, /if \(!histSessionId \|\| forkFrom\) void loadProjects\(\)/)
  assert.doesNotMatch(sessionCreateSection, /if \(!histSessionId \|\| forkFrom\) await loadProjects\(\)/)
})

test('历史预加载失败后按最终会话身份重试，临时失败不伪装为空白会话', () => {
  assert.match(sessionCreateSection, /historyLoadPromise = loadHistory\(encodedDir, histSessionId, 'append', true, true\)/)
  assert.match(sessionCreateSection, /if \(!historyLoaded && activeTabId\.value === tab\.id && tab\.historySessionId\)/)
  assert.match(sessionCreateSection, /loadHistory\(encodeProjectName\(tab\.projectPath\), tab\.historySessionId, 'replace', true\)/)
  assert.match(source, /if \(!suppressError\) messages\.value\.push\(\{role: 'error', text: t\('err\.historyLoad'\)/)
})

test('重启后 runtime 丢失时按历史 ID 恢复原 Tab 和上下文', () => {
  const recreateSection = switchTabSection.slice(
    switchTabSection.indexOf("if (recovery.kind === 'recreate')"),
    switchTabSection.indexOf("if (recovery.kind === 'reset')"),
  )
  assert.ok(recreateSection.length > 0, '未找到 runtime 重建分支')
  assert.match(recreateSection, /sessionMissing = true/)
  assert.doesNotMatch(recreateSection, /_doHandleNewSession\([\s\S]*?undefined,[\s\S]*?checkedRuntimeSessionId\)/)

  const missingRuntimeSection = switchTabSection.slice(
    switchTabSection.indexOf('if (tab.historySessionId && sessionMissing)'),
    switchTabSection.indexOf('} else {', switchTabSection.indexOf('if (tab.historySessionId && sessionMissing)')),
  )
  assert.match(missingRuntimeSection, /tab\.state\.sessionId = null/)
  assert.match(missingRuntimeSection, /_doHandleNewSession\(tab\.projectPath, encodeProjectName\(tab\.projectPath\), tab\.historySessionId/)
})

test('新会话清空旧会话执行态，组件卸载不停止其他会话任务', () => {
  const resetSection = source.slice(
    source.indexOf('function resetSessionExecutionState()'),
    source.indexOf('/** 格式化毫秒时长', source.indexOf('function resetSessionExecutionState()')),
  )
  assert.match(resetSection, /taskActivity\.value = createTaskActivityState\(\)/)
  assert.match(resetSection, /parentTaskUi\.value = createParentTaskUiState\(\)/)
  assert.match(resetSection, /sessionLifecycle\.value = createSessionLifecycleState\(\)/)
  assert.match(resetSection, /wfRunState\.value = null/)
  assert.match(sessionCreateSection, /if \(!preserveExistingState\) \{\s*resetSessionExecutionState\(\)/)

  const unmountSection = source.slice(source.indexOf('onBeforeUnmount(() => {'), source.indexOf('// ══', source.indexOf('onBeforeUnmount(() => {')))
  assert.doesNotMatch(unmountSection, /requestStopSession\(|stop_generation|\/stop/)
})

test('后台会话的失败草稿和历史去重集合写回事件所属标签页', () => {
  const socketSection = source.slice(
    source.indexOf('async function connectWS('),
    source.indexOf('// ── Workflow 停止', source.indexOf('async function connectWS(')),
  )
  assert.match(socketSection, /saveDraftForTab\(tab, originalTask, true\)/)
  assert.doesNotMatch(socketSection, /saveDraftForTab\(activeTab\.value, originalTask, true\)/)
  assert.match(source, /loadedHistoryTexts: _loadedHistoryTexts \? new Set\(_loadedHistoryTexts\) : null/)
  assert.match(source, /_loadedHistoryTexts = s\.loadedHistoryTexts \? new Set\(s\.loadedHistoryTexts\) : null/)
})

test('会话异常统一写入当前聊天窗口并覆盖流、任务、Workflow、Agent 和连接故障', () => {
  assert.match(source, /function appendSessionError\(/)
  assert.match(source, /function appendSessionErrorToTab\(/)
  for (const eventType of ['task_failed', 'stream_error', 'workflow_error', 'workflow_agent_error', 'agent_error', 'subagent_error']) {
    assert.match(source, new RegExp(`appendSessionError\\([\\s\\S]{0,120}${eventType === 'task_failed' ? 'terminalDetail' : eventType === 'stream_error' ? 'detail' : eventType === 'workflow_error' ? 'msg\\.error' : eventType === 'workflow_agent_error' ? 'msg\\.error' : 'msg\\.error'}`))
  }
  assert.match(source, /appendSessionError\(`会话连接已断开/)
  assert.match(source, /appendSessionErrorToTab\(myTabId, `会话连接已断开/)
  assert.match(source, /errorKey: key/)
  assert.match(source, /sanitizeErrorMessage\(candidate, 1000\)/)
})

test('任务进度面板保留连续 hover 命中区并延迟关闭', () => {
  assert.match(source, /\.task-activity::before\s*\{[\s\S]*?bottom: 100%;[\s\S]*?height: 10px;/)
  assert.match(source, /\.task-activity-popover::after\s*\{[\s\S]*?bottom: -9px;[\s\S]*?height: 9px;/)
  assert.match(source, /visibility 0s linear 360ms/)
})

test('过滤消息时使用消息对象作为稳定 key，避免底部滚动期间整批重挂载', () => {
  assert.match(source, /const messageRenderKeys = new WeakMap<Message, string>\(\)/)
  assert.match(source, /v-for="\(msg, i\) in renderedMessages" :key="messageRenderKey\(msg\)"/)
  assert.doesNotMatch(source, /v-for="\(msg, i\) in renderedMessages" :key="\(msg\.time \|\| 0\) \+ '-' \+ i \+ '-' \+ msg\.role"/)
})
