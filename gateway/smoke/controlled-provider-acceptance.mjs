/**
 * 受控真实 Provider 验收：只在显式环境变量开启时创建单回合只读会话。
 * 不打印 Bridge token、任务正文、工作目录或模型回复，避免把运行凭据和会话内容写入日志。
 */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {isAbsolute, join} from 'node:path'
import WebSocket from 'ws'
import {BRIDGE_HOME} from '../config/bridge-home.mjs'

if (process.env.BRIDGE_RUN_CONTROLLED_PROVIDER_ACCEPTANCE !== '1') {
  console.log('受控真实 Provider 验收已跳过；设置 BRIDGE_RUN_CONTROLLED_PROVIDER_ACCEPTANCE=1 后运行。')
} else {
  const baseUrl = 'http://127.0.0.1:3456'
  const token = readFileSync(join(BRIDGE_HOME, 'bridge-token'), 'utf8').trim()
  const requestedWorkDir = String(process.env.BRIDGE_CONTROLLED_PROVIDER_WORK_DIR || '').trim()
  assert.ok(!requestedWorkDir || isAbsolute(requestedWorkDir), '受控项目工作目录必须是绝对路径')
  const requestedTimeoutMs = Number.parseInt(process.env.BRIDGE_CONTROLLED_PROVIDER_TIMEOUT_MS || '55000', 10)
  assert.ok(Number.isInteger(requestedTimeoutMs) && requestedTimeoutMs >= 30_000 && requestedTimeoutMs <= 180_000,
    '受控 Provider 验收超时必须在 30–180 秒之间')
  // 仅在显式验收时切换目标项目，且不输出该路径，避免常规 smoke 误用或泄露目录。
  const workDir = requestedWorkDir || process.cwd()
  const prompt = '这是受控运行验收。请仅回复“运行验收已收到”。不要调用工具，不要执行命令，不要读取或修改任何文件。'
  const createResponse = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-bridge-token': token},
    body: JSON.stringify({workDir, permissionMode: 'plan', maxTurns: 1}),
  })
  assert.equal(createResponse.status, 201, 'Gateway 未能创建受控验收会话')
  const {sessionId} = await createResponse.json()
  assert.equal(typeof sessionId, 'string')

  const observation = await new Promise((resolve, reject) => {
    const eventTypes = []
    let lastBubbleType = null
    let textLength = 0
    let resultCount = 0
    let taskCompletionCount = 0
    let terminalReplyLength = 0
    let settleTimer = null
    const timeout = setTimeout(() => finish(new Error(`真实 Provider 在 ${Math.round(requestedTimeoutMs / 1000)} 秒内未返回 result 事件`)), requestedTimeoutMs)
    const ws = new WebSocket(`ws://127.0.0.1:3456/ws/${sessionId}`, {
      headers: {'x-bridge-token': token},
    })

    function finish(error) {
      clearTimeout(timeout)
      clearTimeout(settleTimer)
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close()
      if (error) reject(error)
      else resolve({eventTypes, lastBubbleType, textLength, resultCount, taskCompletionCount, terminalReplyLength})
    }

    ws.on('open', () => ws.send(JSON.stringify({type: 'user_message', content: prompt})))
    ws.on('message', raw => {
      const event = JSON.parse(raw.toString())
      eventTypes.push(event.type)
      if (['assistant_message', 'task_step', 'task_completed', 'task_failed', 'error'].includes(event.type)) {
        lastBubbleType = event.type
      }
      if (event.type === 'text_delta') textLength += String(event.text || '').length
      if (event.type === 'assistant_message') {
        textLength += (event.message?.content || [])
          .filter(block => block?.type === 'text')
          .reduce((total, block) => total + String(block.text || '').length, 0)
      }
      if (event.type === 'task_completed') {
        taskCompletionCount += 1
        terminalReplyLength = Math.max(terminalReplyLength, String(event.reply || event.taskState?.finalReplyText || '').length)
      }
      if (event.type === 'error' || event.type === 'task_failed') {
        finish(new Error(`Gateway 返回终态 ${event.type}`))
        return
      }
      if (event.type === 'result') {
        resultCount += 1
        // 为异步完成门禁留下短暂窗口，确认同一任务不会重复发完成事件。
        settleTimer = setTimeout(() => finish(), 2500)
      }
    })
    ws.on('error', finish)
  })

  assert.equal(observation.resultCount, 1, '受控会话必须恰好收到一个 result 事件')
  assert.ok(observation.textLength > 0, '真实 Provider 回复为空')
  assert.ok(observation.taskCompletionCount <= 1, '同一任务重复发送 task_completed')
  if (observation.taskCompletionCount === 1) {
    assert.ok(observation.terminalReplyLength > 0, 'task_completed 缺少最终总结')
    assert.equal(observation.lastBubbleType, 'task_completed', '最终总结必须是最后一个业务气泡事件')
  }
  console.log(JSON.stringify({
    verified: true,
    resultCount: observation.resultCount,
    nonEmptyReply: observation.textLength > 0,
    taskCompletionCount: observation.taskCompletionCount,
    terminalSummaryPresent: observation.terminalReplyLength > 0,
  }))
}
