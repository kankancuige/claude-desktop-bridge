export interface SessionLifecycleState {
  version: number
  received: boolean
  active: boolean
  sequence: number
  canSend: boolean
  canStop: boolean
  canContinue: boolean
  awaitingAcceptance: boolean
}

export function createSessionLifecycleState(input: Partial<SessionLifecycleState> = {}): SessionLifecycleState {
  return {
    version: 1,
    received: input.received === true,
    active: input.active === true,
    sequence: Number.isFinite(Number(input.sequence)) ? Math.max(0, Number(input.sequence)) : 0,
    canSend: input.canSend !== false,
    canStop: input.canStop === true,
    canContinue: input.canContinue === true,
    awaitingAcceptance: input.awaitingAcceptance === true,
  }
}

export function reduceSessionLifecycle(current: SessionLifecycleState, event: any): SessionLifecycleState {
  const state = createSessionLifecycleState(current)
  if (event?.type === 'session_lifecycle_snapshot') {
    const active = event.active === true
    return createSessionLifecycleState({
      received: true,
      active,
      sequence: event.sequence,
      canSend: event.capabilities?.canSend === true,
      canStop: event.capabilities?.canStop === true,
      canContinue: event.capabilities?.canContinue === true,
      awaitingAcceptance: false,
    })
  }

  if (event?.type === 'local_task_submitted') {
    if (state.active) return state
    return {...state, active: true, canSend: false, canStop: true, canContinue: false, awaitingAcceptance: true}
  }
  if (event?.type === 'message_accepted') {
    return {...state, awaitingAcceptance: false}
  }
  if (['task_started', 'task_reviewing', 'task_changes_required', 'task_fixing', 'workflow_started', 'workflow_resumed'].includes(event?.type)) {
    return {...state, active: true, canSend: false, canStop: true, canContinue: false, awaitingAcceptance: false}
  }
  if (event?.type === 'generation_stopped') {
    if (state.received) return state
    return {...state, received: true, active: false, canSend: true, canStop: false, canContinue: true}
  }
  if (event?.type === 'message_rejected') {
    if (!state.awaitingAcceptance) return state
    return {...state, active: false, canSend: true, canStop: false, canContinue: false, awaitingAcceptance: false}
  }
  // 流式响应中断时，Gateway 会同时携带终态 taskState；即使生命周期快照稍后到达，也必须先释放输入区。
  // 这里仅接受明确的终态状态，避免普通 SDK/工具错误把仍在运行的父任务误判为空闲。
  if (['error', 'stream_error'].includes(event?.type)) {
    const status = String(event?.taskState?.status || '')
    if (['succeeded', 'interrupted', 'failed', 'incomplete', 'stopped', 'review_paused'].includes(status)) {
      return {
        ...state,
        received: true,
        active: false,
        canSend: true,
        canStop: false,
        canContinue: status !== 'succeeded' && event.taskState?.resumable === true,
        awaitingAcceptance: false,
      }
    }
  }
  if (['task_completed', 'task_failed', 'task_review_paused'].includes(event?.type)) {
    // 新版 Gateway 会紧接着发送聚合快照；终态事件只渲染结果，不能在快照前抢先释放队列。
    if (state.received) return state
    const canContinue = event?.type !== 'task_completed' && event?.taskState?.resumable === true
    return {...state, received: true, active: false, canSend: true, canStop: false, canContinue, awaitingAcceptance: false}
  }
  return state
}
