/**
 * 受控真实 Provider 同模型重连验收：重建 Gateway Query 后仍只报告本地可证明的
 * same_partition_possible，不把 resume 或重连写成 cache hit/免费调用。
 */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import WebSocket from 'ws'
import {BRIDGE_HOME} from '../config/bridge-home.mjs'

if (process.env.BRIDGE_RUN_CONTROLLED_SAME_MODEL_RECONNECT_ACCEPTANCE !== '1') {
  console.log('受控同模型重连验收已跳过；设置 BRIDGE_RUN_CONTROLLED_SAME_MODEL_RECONNECT_ACCEPTANCE=1 后运行。')
} else {
  const baseUrl = 'http://127.0.0.1:3456'
  const token = readFileSync(join(BRIDGE_HOME, 'bridge-token'), 'utf8').trim()
  const model = process.env.BRIDGE_RECONNECT_MODEL || 'gpt-5.6-terra'
  const headers = {'Content-Type': 'application/json', 'x-bridge-token': token}

  const createResponse = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST', headers,
    body: JSON.stringify({workDir: process.cwd(), permissionMode: 'plan', maxTurns: 1,
      model, modelMode: 'auto'}),
  })
  assert.equal(createResponse.status, 201, 'Gateway 未能创建同模型重连验收会话')
  const created = await createResponse.json()
  const {sessionId} = created
  assert.equal(typeof sessionId, 'string')

  async function runTurn(content, messageId, extra = {}) {
    return new Promise((resolve, reject) => {
      let resultCount = 0
      const policies = []
      const timeout = setTimeout(() => finish(new Error('同模型重连验收在 70 秒内未完成')), 70_000)
      const ws = new WebSocket(`ws://127.0.0.1:3456/ws/${sessionId}`, {headers: {'x-bridge-token': token}})
      function finish(error) {
        clearTimeout(timeout)
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close()
        if (error) reject(error)
        else resolve({resultCount, policies})
      }
      ws.on('open', () => ws.send(JSON.stringify({type: 'user_message', content, taskText: content,
        messageId, model, permissionMode: 'plan', ...extra})))
      ws.on('message', raw => {
        const event = JSON.parse(raw.toString())
        if (event.type === 'context_rebuild_policy') policies.push({
          policy: event.policy, cacheEligibility: event.cacheEligibility,
        })
        if (event.type === 'error' || event.type === 'task_failed') {
          finish(new Error(`Gateway 返回终态 ${event.type}`)); return
        }
        if (event.type === 'result') {
          resultCount += 1
          setTimeout(() => finish(), 1500)
        }
      })
      ws.on('error', finish)
    })
  }

  const first = await runTurn('这是同模型重连验收第一回合。请只回复“已收到”，不要调用工具。', 'controlled-reconnect-first', {modelMode: 'auto'})
  assert.equal(first.resultCount, 1)
  await new Promise(resolve => setTimeout(resolve, 1200))

  const resumeResponse = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST', headers,
    body: JSON.stringify({workDir: process.cwd(), resume: sessionId, permissionMode: 'plan',
      maxTurns: 1, model, modelMode: 'fixed'}),
  })
  assert.ok([200, 201].includes(resumeResponse.status), 'Gateway 未能重建同模型会话')
  const resumed = await resumeResponse.json()
  assert.equal(resumed.resumed, true)

  const second = await runTurn('这是同模型重连验收第二回合。请只回复“重连已收到”，不要调用工具。',
    'controlled-reconnect-second', {modelMode: 'fixed', contextSwitchMode: 'full_history'})
  assert.equal(second.resultCount, 1)
  const policy = second.policies.find(item => item.cacheEligibility === 'same_partition_possible')
  assert.ok(policy, '未观察到同 Provider/同模型的 same_partition_possible 策略')
  assert.ok(['reuse_same_session', 'start_fresh'].includes(policy.policy))
  assert.notEqual(policy.policy, 'cache_hit')
  console.log(JSON.stringify({verified: true, resumed: resumed.resumed, policy: policy.policy,
    cacheEligibility: policy.cacheEligibility, resultCount: first.resultCount + second.resultCount}))
}
