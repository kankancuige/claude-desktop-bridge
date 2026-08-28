export interface SessionCreateRequest {
  workDir: string
  resume?: string
  forkFrom?: string
  recoverSessionId?: string
}

export function buildSessionCreateRequest(input: SessionCreateRequest): SessionCreateRequest {
  const resume = String(input.resume || '').trim()
  const forkFrom = String(input.forkFrom || '').trim()
  const recoverSessionId = String(input.recoverSessionId || '').trim()
  if ([resume, forkFrom, recoverSessionId].filter(Boolean).length > 1) throw new Error('恢复、分支和重建不能同时指定')
  return {
    workDir: input.workDir,
    ...(resume ? {resume} : {}),
    ...(forkFrom ? {forkFrom} : {}),
    ...(recoverSessionId ? {recoverSessionId} : {}),
  }
}

export function shouldReuseTabForSessionCreate(input: {
  mode: 'new' | 'resume' | 'fork'
  requestedSessionId?: string | null
  tabHistorySessionId?: string | null
}): boolean {
  return input.mode === 'resume'
    && !!input.requestedSessionId
    && input.requestedSessionId === input.tabHistorySessionId
}
