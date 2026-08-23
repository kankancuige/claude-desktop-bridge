/**
 * 受控真实补充指令验收：同一会话在首回合重建期间连续发送两条只读消息。
 * 不输出凭据、任务正文、工作目录或模型回复，只保留事件计数和顺序断言。
 */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import WebSocket from 'ws'
import {BRIDGE_HOME} from '../config/bridge-home.mjs'

if (process.env.BRIDGE_RUN_CONTROLLED_SUPPLEMENTAL_ACCEPTANCE !== '1') {
  console.log('受控真实补充指令验收已跳过；设置 BRIDGE_RUN_CONTROLLED_SUPPLEMENTAL_ACCEPTANCE=1 后运行。')
} else {
  const token = readFileSync(join(BRIDGE_HOME, 'bridge-token'), 'utf8').trim()
  const createResponse = await fetch('http://127.0.0.1:3456/api/sessions', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-bridge-token': token},
    body: JSON.stringify({workDir: process.cwd(), permissionMode: 'plan', maxTurns: 2}),
  })
  assert.equal(createResponse.status, 201, 'Gateway 未能创建受控补充指令会话')
  const {sessionId} = await createResponse.json()
  assert.equal(typeof sessionId, 'string')

  const observation = await new Promise((resolve, reject) => {
    const accepted = []
    const eventTypes = []
    let resultCount = 0
    let completionCount = 0
    let completionAfterResultCount = null
    let settled = false
    let settleTimer = null
    const timeout = setTimeout(() => finish(new Error(`真实补充指令验收未在 70 秒内完成两个 Provider 回合；accepted=${accepted.length}; results=${resultCount}; completions=${completionCount}; events=${eventTypes.slice(-20).join(',')}`)), 70_000)
    const ws = new WebSocket(`ws://127.0.0.1:3456/ws/${sessionId}`, {headers: {'x-bridge-token': token}})

    function finish(error) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearTimeout(settleTimer)
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close()
      if (error) reject(error)
      else resolve({accepted, eventTypes, resultCount, completionCount, completionAfterResultCount})
    }

    ws.on('open', () => {
      // 两条消息同一 tick 发出，第二条必经 Gateway 输入队列，而非前端延后重派发。
      ws.send(JSON.stringify({
        type: 'user_message',
        messageId: 'controlled-primary',
        content: '受控主消息：仅回复“第一条已处理”。不要调用工具、命令或文件操作。',
        taskText: '受控主消息：仅回复“第一条已处理”。不要调用工具、命令或文件操作。',
        permissionMode: 'plan',
        thinkingLevel: 'off',
        modelMode: 'auto',
        _noWorkflow: true,
      }))
      ws.send(JSON.stringify({
        type: 'user_message',
        messageId: 'controlled-follow-up',
        content: '受控补充消息：仅回复“第二条已处理”。不要调用工具、命令或文件操作。',
        taskText: '受控补充消息：仅回复“第二条已处理”。不要调用工具、命令或文件操作。',
        permissionMode: 'plan',
        thinkingLevel: 'off',
        modelMode: 'auto',
        _noWorkflow: true,
      }))
    })
    ws.on('message', raw => {
      const event = JSON.parse(raw.toString())
      eventTypes.push(event.type)
      if (event.type === 'message_accepted') accepted.push({messageId: event.messageId, queuePosition: event.queuePosition})
      if (event.type === 'result') {
        resultCount += 1
        if (resultCount === 2) {
          // 等待 Completion Gate 的异步副作用；它只能在第二条 result 后发送终态。
          settleTimer = setTimeout(() => finish(), 2500)
        }
      }
      if (event.type === 'task_completed') {
        completionCount += 1
        completionAfterResultCount = resultCount
      }
      if (event.type === 'error' || event.type === 'task_failed') {
        finish(new Error(`Gateway 返回终态 ${event.type}`))
      }
    })
    ws.on('error', finish)
  })

  assert.deepEqual(observation.accepted.map(item => item.messageId), ['controlled-primary', 'controlled-follow-up'])
  assert.deepEqual(observation.accepted.map(item => item.queuePosition), [0, 1])
  assert.equal(observation.resultCount, 2, 'Gateway 必须按序完成两个 Provider 回合')
  assert.ok(observation.completionCount <= 1, '同一父任务不能重复发送 task_completed')
  if (observation.completionCount === 1) {
    assert.equal(observation.completionAfterResultCount, 2, '最终总结不得早于补充指令的 result')
  }
  console.log(JSON.stringify({
    verified: true,
    acceptedCount: observation.accepted.length,
    queuePositions: observation.accepted.map(item => item.queuePosition),
    resultCount: observation.resultCount,
    completionCount: observation.completionCount,
    completionAfterSecondResult: observation.completionCount === 0 || observation.completionAfterResultCount === 2,
  }))
}
