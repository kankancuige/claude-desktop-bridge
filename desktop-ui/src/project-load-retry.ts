/** 首屏 Gateway 尚未就绪时的有限重试计划，避免无限定时器掩盖真实故障。 */
export const PROJECT_LOAD_RETRY_DELAYS_MS = [400, 1_000, 2_000, 4_000] as const

export function nextProjectLoadRetry(attempt: number, pending: boolean): {attempt: number; delayMs: number} | null {
  if (pending || attempt < 0 || attempt >= PROJECT_LOAD_RETRY_DELAYS_MS.length) return null
  return {attempt: attempt + 1, delayMs: PROJECT_LOAD_RETRY_DELAYS_MS[attempt]}
}
