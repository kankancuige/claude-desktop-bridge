export interface SessionCreateRequest {
  workDir: string
  resume?: string
  forkFrom?: string
}

export function buildSessionCreateRequest(input: SessionCreateRequest): SessionCreateRequest {
  const resume = String(input.resume || '').trim()
  const forkFrom = String(input.forkFrom || '').trim()
  if (resume && forkFrom) throw new Error('恢复和分支不能同时指定')
  return {
    workDir: input.workDir,
    ...(resume ? {resume} : {}),
    ...(forkFrom ? {forkFrom} : {}),
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
