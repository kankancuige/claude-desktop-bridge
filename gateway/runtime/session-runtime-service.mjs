/**
 * Session Runtime 的组合边界。
 *
 * 会话对象仍由上层根据 SDK/业务需要创建；本服务只拥有运行时集合以及
 * 与集合同生命周期的输入队列和任务协调器，避免组合根重复初始化并形成
 * 隐式共享状态。
 */
import {createTaskInputQueue} from '../sessions/task-input-queue.mjs'
import {createSessionCoordinator} from '../sessions/session-coordinator.mjs'
import {createSessionStatePort} from './session-state-port.mjs'

export function createSessionRuntimeService({
    maxPending = 32,
    imSources = ['wechat', 'feishu', 'dingtalk'],
    createInputQueue = createTaskInputQueue,
    createCoordinator = createSessionCoordinator,
} = {}) {
    if (!Number.isInteger(maxPending) || maxPending < 1) {
        throw new TypeError('maxPending must be a positive integer')
    }
    const sessions = new Map()
    const inputQueue = createInputQueue({maxPending, imSources: new Set(imSources)})
    const coordinator = createCoordinator()
    let focusedSessionId = null
    let disposed = false
    const statePort = createSessionStatePort({
        sessions,
        getFocusedSessionId: () => focusedSessionId,
        setFocusedSessionId: value => { focusedSessionId = value },
    })

    const ensureActive = () => {
        if (disposed) throw Object.assign(new Error('Session Runtime 已释放'), {code: 'SESSION_RUNTIME_DISPOSED'})
    }

    return {
        sessions: statePort,
        statePort,
        inputQueue,
        coordinator,
        get focusedSessionId() {
            return focusedSessionId
        },
        setFocusedSession(sessionId) {
            ensureActive()
            if (sessionId !== null && typeof sessionId !== 'string') {
                throw new TypeError('focused session id must be a string or null')
            }
            if (sessionId !== null && !sessions.has(sessionId)) return false
            focusedSessionId = sessionId
            return true
        },
        get(sessionId) {
            return sessions.get(sessionId) || null
        },
        register(sessionId, session) {
            ensureActive()
            if (!sessionId || !session || typeof session !== 'object') {
                throw new TypeError('session id and session object are required')
            }
            if (sessions.has(sessionId)) {
                throw Object.assign(new Error('Session 已存在'), {code: 'SESSION_ALREADY_REGISTERED'})
            }
            sessions.set(sessionId, session)
            return session
        },
        unregister(sessionId) {
            ensureActive()
            const removed = sessions.delete(sessionId)
            if (focusedSessionId === sessionId) focusedSessionId = null
            return removed
        },
        dispose() {
            if (disposed) return false
            disposed = true
            statePort.dispose()
            return true
        },
        get disposed() {
            return disposed
        },
    }
}
