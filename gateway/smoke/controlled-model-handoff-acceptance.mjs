/**
 * 受控真实 Provider 模型 handoff 验收：只在显式环境变量开启时运行。
 * 不打印 Bridge token、任务正文、工作目录或模型回复。
 */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import WebSocket from 'ws'
import {BRIDGE_HOME} from '../config/bridge-home.mjs'

if (process.env.BRIDGE_RUN_CONTROLLED_MODEL_HANDOFF_ACCEPTANCE !== '1') {
  console.log('受控模型 handoff 验收已跳过；设置 BRIDGE_RUN_CONTROLLED_MODEL_HANDOFF_ACCEPTANCE=1 后运行。')
} else {
  const baseUrl = 'http://127.0.0.1:3456'
  const token = readFileSync(join(BRIDGE_HOME, 'bridge-token'), 'utf8').trim()
  const firstModel = process.env.BRIDGE_HANDOFF_SOURCE_MODEL || 'gpt-5.6-terra'
  const secondModel = process.env.BRIDGE_HANDOFF_TARGET_MODEL || 'gpt-5.6-sol'
  const prompts = [
    '这是受控模型切换验收的第一回合。请只回复“第一回合已收到”，不要调用工具或修改文件。',
    '这是同一会话的模型 handoff 第二回合。请只回复“handoff 已收到”，不要调用工具或修改文件。',
  ]
  const createResponse = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-bridge-token': token},
    body: JSON.stringify({workDir: process.cwd(), permissionMode: 'plan', maxTurns: 1}),
  })
  assert.equal(createResponse.status, 201, 'Gateway 未能创建受控 handoff 会话')
  const {sessionId} = await createResponse.json()
  assert.equal(typeof sessionId, 'string')

  const observation = await new Promise((resolve, reject) => {
    const policies = []
    let resultCount = 0
    let replyLength = 0
    let secondSent = false
    let settleTimer = null
    const timeout = setTimeout(() => finish(new Error('模型 handoff 在 70 秒内未完成')), 70_000)
    const ws = new WebSocket(`ws://127.0.0.1:3456/ws/${sessionId}`, {
      headers: {'x-bridge-token': token},
    })

    function finish(error) {
      clearTimeout(timeout)
      clearTimeout(settleTimer)
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close()
      if (error) reject(error)
      else resolve({policies, resultCount, replyLength})
    }

    function send(index, model, contextSwitchMode = 'full_history') {
      ws.send(JSON.stringify({
        type: 'user_message',
        content: prompts[index],
        taskText: prompts[index],
        modelMode: 'fixed',
        model,
        contextSwitchMode,
        permissionMode: 'plan',
        thinkingLevel: 'off',
        messageId: `controlled-handoff-${index}`,
      }))
    }

    ws.on('open', () => send(0, firstModel))
    ws.on('message', raw => {
      const event = JSON.parse(raw.toString())
      if (event.type === 'context_rebuild_policy') policies.push({
        policy: event.policy,
        cacheEligibility: event.cacheEligibility,
      })
      if (event.type === 'task_completed') replyLength = Math.max(replyLength, String(event.reply || event.taskState?.finalReplyText || '').length)
      if (event.type === 'error' || event.type === 'task_failed') {
        finish(new Error(`Gateway 返回终态 ${event.type}`))
        return
      }
      if (event.type !== 'result') return
      resultCount += 1
      if (!secondSent) {
        secondSent = true
        send(1, secondModel, 'handoff_summary')
        return
      }
      settleTimer = setTimeout(() => finish(), 2500)
    })
    ws.on('error', finish)
  })

  const handoffPolicy = observation.policies.find(item => item.policy === 'handoff_summary')
  assert.ok(handoffPolicy, '未观察到 handoff_summary 策略事件')
  assert.equal(handoffPolicy.cacheEligibility, 'cross_model_unavailable')
  assert.equal(observation.resultCount, 2, '模型 handoff 必须各产生一个 result')
  assert.ok(observation.replyLength > 0, '模型 handoff 最终回复为空')
  console.log(JSON.stringify({
    verified: true,
    policy: handoffPolicy.policy,
    cacheEligibility: handoffPolicy.cacheEligibility,
    resultCount: observation.resultCount,
    nonEmptyReply: observation.replyLength > 0,
  }))
}
