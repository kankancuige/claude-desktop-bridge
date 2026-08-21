/**
 * 受控真实停止验收：只在显式环境变量开启时发送一条只读短请求后连续停止两次。
 * 不输出凭据、任务正文、工作目录或模型内容，只记录事件计数。
 */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import WebSocket from 'ws'
import {BRIDGE_HOME} from '../config/bridge-home.mjs'

if (process.env.BRIDGE_RUN_CONTROLLED_STOP_ACCEPTANCE !== '1') {
  console.log('受控真实停止验收已跳过；设置 BRIDGE_RUN_CONTROLLED_STOP_ACCEPTANCE=1 后运行。')
} else {
  const token = readFileSync(join(BRIDGE_HOME, 'bridge-token'), 'utf8').trim()
  const createResponse = await fetch('http://127.0.0.1:3456/api/sessions', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-bridge-token': token},
    body: JSON.stringify({workDir: process.cwd(), permissionMode: 'plan', maxTurns: 1}),
  })
  assert.equal(createResponse.status, 201, 'Gateway 未能创建受控停止会话')
  const {sessionId} = await createResponse.json()
  assert.equal(typeof sessionId, 'string')

  const observation = await new Promise((resolve, reject) => {
    let stoppedCount = 0
    let completedCount = 0
    let resultCount = 0
    const timeout = setTimeout(() => finish(new Error('真实停止验收在 20 秒内未返回停止终态')), 20_000)
    const ws = new WebSocket(`ws://127.0.0.1:3456/ws/${sessionId}`, {headers: {'x-bridge-token': token}})

    function finish(error) {
      clearTimeout(timeout)
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close()
      if (error) reject(error)
      else resolve({stoppedCount, completedCount, resultCount})
    }

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'user_message',
        content: '这是受控停止验收。不要调用工具、命令或文件操作；请在回复前等待。',
      }))
      setTimeout(() => {
        ws.send(JSON.stringify({type: 'stop_generation'}))
        ws.send(JSON.stringify({type: 'stop_generation'}))
      }, 100)
    })
    ws.on('message', raw => {
      const event = JSON.parse(raw.toString())
      if (event.type === 'generation_stopped') {
        stoppedCount += 1
        setTimeout(() => finish(), 500)
      }
      if (event.type === 'task_completed') completedCount += 1
      if (event.type === 'result') resultCount += 1
      if (event.type === 'error' || event.type === 'task_failed') finish(new Error(`Gateway 返回终态 ${event.type}`))
    })
    ws.on('error', finish)
  })

  assert.equal(observation.stoppedCount, 1, '重复 stop 必须只产生一个 generation_stopped')
  assert.equal(observation.completedCount, 0, '用户停止后不能产生 task_completed')
  console.log(JSON.stringify({verified: true, ...observation}))
}
