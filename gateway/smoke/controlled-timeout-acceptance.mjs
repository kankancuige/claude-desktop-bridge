/**
 * 受控真实 Provider idle-timeout 验收。
 * 仅在 Gateway 的系统设置 streamWatchdog.idleTimeoutMs=30000（或更小的有效值）下运行，
 * 不记录 Prompt、回复、凭据或路径；收到正常 result 只能判定为未触发 timeout。
 */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import WebSocket from 'ws'
import {BRIDGE_HOME} from '../config/bridge-home.mjs'
import {normalizeStreamWatchdogConfig} from '../config/stream-watchdog-config.mjs'

if (process.env.BRIDGE_RUN_CONTROLLED_TIMEOUT_ACCEPTANCE !== '1') {
  console.log('受控 Provider timeout 验收已跳过；设置 BRIDGE_RUN_CONTROLLED_TIMEOUT_ACCEPTANCE=1 后运行。')
} else {
  const settings = JSON.parse(readFileSync(join(BRIDGE_HOME, 'settings.json'), 'utf8'))
  const configuredTimeout = normalizeStreamWatchdogConfig(settings.streamWatchdog).idleTimeoutMs
  assert.ok(configuredTimeout >= 30_000 && configuredTimeout <= 45_000,
    'Gateway 必须以 30000–45000ms 的 idle timeout 启动')
  const token = readFileSync(join(BRIDGE_HOME, 'bridge-token'), 'utf8').trim()
  const headers = {'Content-Type': 'application/json', 'x-bridge-token': token}
  const createdResponse = await fetch('http://127.0.0.1:3456/api/sessions', {
    method: 'POST', headers,
    body: JSON.stringify({workDir: process.cwd(), permissionMode: 'plan', maxTurns: 1}),
  })
  assert.equal(createdResponse.status, 201)
  const {sessionId} = await createdResponse.json()

  const outcome = await new Promise((resolve, reject) => {
    let timeoutEvent = null
    let resultCount = 0
    let finished = false
    let terminalBeforeTimeout = null
    const deadline = setTimeout(() => {
      const detail = terminalBeforeTimeout
        ? `Provider 在 idle timeout 前产生了终态：${terminalBeforeTimeout}`
        : 'Provider idle timeout 未在预期窗口内触发'
      finish(new Error(detail))
    }, configuredTimeout + 20_000)
    const ws = new WebSocket(`ws://127.0.0.1:3456/ws/${sessionId}`, {headers: {'x-bridge-token': token}})
    function finish(error) {
      if (finished) return
      finished = true
      clearTimeout(deadline)
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close()
      if (error) reject(error)
      else resolve({timeoutEvent, resultCount})
    }
    ws.on('open', () => ws.send(JSON.stringify({
      type: 'user_message',
      content: '这是受控 idle timeout 验收。请等待至少 60 秒后再回复，等待期间不要发送任何文本、工具调用或 progress 事件。',
      taskText: '这是受控 idle timeout 验收。',
      modelMode: 'fixed',
      model: process.env.BRIDGE_RECONNECT_MODEL || 'gpt-5.6-terra',
      permissionMode: 'plan',
      thinkingLevel: 'off',
      noWorkflow: true,
      messageId: 'controlled-timeout',
    })))
    ws.on('message', raw => {
      const event = JSON.parse(raw.toString())
      if (event.type === 'result') resultCount += 1
      if (event.type === 'error' && event.code === 'stream_idle_timeout') {
        timeoutEvent = event.code
        setTimeout(() => finish(), 1000)
      }
      // Gateway 会在 timeout error 前或后广播 task_failed；记录顺序，但仍以 timeout error 为验收依据。
      if (!timeoutEvent && (event.type === 'task_completed' || event.type === 'task_failed')) terminalBeforeTimeout = event.type
    })
    ws.on('error', finish)
  })

  assert.equal(outcome.timeoutEvent, 'stream_idle_timeout')
  assert.equal(outcome.resultCount, 0)
  console.log(JSON.stringify({verified: true, timeoutCode: outcome.timeoutEvent, resultCount: outcome.resultCount}))
}
