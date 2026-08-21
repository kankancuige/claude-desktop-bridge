function nonNegativeInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback
}

/**
 * 主进程只负责进程和 timer 副作用；此处固定异常退出后的重启预算与退避语义，
 * 让正常退出、手工停止和崩溃恢复可以分别验证。
 */
function decideGatewayRestart({
  exitCode,
  restartCount = 0,
  maxRestarts = 5,
  baseDelayMs = 2000,
  maxDelayMs = 30_000,
} = {}) {
  const currentCount = nonNegativeInteger(restartCount, 0)
  const limit = nonNegativeInteger(maxRestarts, 5)
  if (exitCode === 0) {
    return {shouldRestart: false, reason: 'normal_exit', restartCount: currentCount, delayMs: null}
  }
  if (currentCount >= limit) {
    return {shouldRestart: false, reason: 'restart_budget_exhausted', restartCount: currentCount, delayMs: null}
  }
  const nextCount = currentCount + 1
  const base = Math.max(1, nonNegativeInteger(baseDelayMs, 2000))
  const maximum = Math.max(base, nonNegativeInteger(maxDelayMs, 30_000))
  return {
    shouldRestart: true,
    reason: 'unexpected_exit',
    restartCount: nextCount,
    delayMs: Math.min(maximum, base * (2 ** (nextCount - 1))),
  }
}

module.exports = {decideGatewayRestart}
