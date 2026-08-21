const assert = require('node:assert/strict')
const test = require('node:test')
const {decideGatewayRestart} = require('./gateway-restart-policy.cjs')

test('异常退出按有限指数退避安排下一次 Gateway 重启', () => {
  assert.deepEqual(decideGatewayRestart({exitCode: 1, restartCount: 0}), {
    shouldRestart: true,
    reason: 'unexpected_exit',
    restartCount: 1,
    delayMs: 2000,
  })
  assert.deepEqual(decideGatewayRestart({exitCode: null, restartCount: 3}), {
    shouldRestart: true,
    reason: 'unexpected_exit',
    restartCount: 4,
    delayMs: 16000,
  })
})

test('正常退出和达到预算上限都不会重新拉起 Gateway', () => {
  assert.deepEqual(decideGatewayRestart({exitCode: 0, restartCount: 2}), {
    shouldRestart: false,
    reason: 'normal_exit',
    restartCount: 2,
    delayMs: null,
  })
  assert.deepEqual(decideGatewayRestart({exitCode: 1, restartCount: 5}), {
    shouldRestart: false,
    reason: 'restart_budget_exhausted',
    restartCount: 5,
    delayMs: null,
  })
})

test('重启延迟受上限约束且不接受负数预算', () => {
  assert.deepEqual(decideGatewayRestart({
    exitCode: 1, restartCount: -3, maxRestarts: 2, baseDelayMs: 20_000, maxDelayMs: 30_000,
  }), {
    shouldRestart: true,
    reason: 'unexpected_exit',
    restartCount: 1,
    delayMs: 20000,
  })
  assert.equal(decideGatewayRestart({
    exitCode: 1, restartCount: 1, maxRestarts: 3, baseDelayMs: 20_000, maxDelayMs: 30_000,
  }).delayMs, 30000)
})
