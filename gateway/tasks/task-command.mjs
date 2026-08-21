import {shouldDeliverTurnEvent} from './turn-routing.mjs'

const TASK_SOURCES = new Set(['desktop', 'wechat', 'feishu', 'dingtalk', 'workflow', 'scheduled'])
const PERMISSION_MODES = new Set(['default', 'acceptEdits', 'plan', 'bypassPermissions'])
const THINKING_LEVELS = new Set(['auto', 'off', 'low', 'medium', 'high', 'xhigh', 'max'])
const MODEL_MODES = new Set(['auto', 'fixed'])
const CONTEXT_SWITCH_MODES = new Set(['full_history', 'handoff_summary'])
const MAX_CONTENT_BYTES = 900_000

function commandError(message, code = 'INVALID_TASK_COMMAND') {
    return Object.assign(new Error(message), {code})
}

function optionalString(value, max) {
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string' || value.length > max) throw commandError('任务命令字符串字段无效')
    return value
}

function optionalJsonObject(value, maxBytes = 8192) {
    if (value === undefined || value === null) return null
    if (typeof value !== 'object' || Array.isArray(value)) throw commandError('任务命令对象字段无效')
    let serialized
    try {
        serialized = JSON.stringify(value)
    } catch (error) {
        throw commandError(`任务命令对象无法序列化: ${error?.message || 'unknown'}`)
    }
    if (!serialized || Buffer.byteLength(serialized, 'utf8') > maxBytes) throw commandError('任务命令对象字段过大')
    return JSON.parse(serialized)
}

function validSessionId(value) {
    return typeof value === 'string'
        && value.length >= 1
        && value.length <= 128
        && value !== '.'
        && value !== '..'
        && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
}

export function normalizeTaskCommand(input = {}) {
    if (!validSessionId(input.sessionId)) throw commandError('任务命令缺少有效 Session ID')
    if (!TASK_SOURCES.has(input.source)) throw commandError('任务命令来源无效')
    if (typeof input.content !== 'string' || !input.content.trim()) throw commandError('任务内容不能为空')
    if (Buffer.byteLength(input.content, 'utf8') > MAX_CONTENT_BYTES) throw commandError('任务内容过长')
    if (input.permissionMode !== undefined && !PERMISSION_MODES.has(input.permissionMode)) throw commandError('权限模式无效')
    if (input.thinkingLevel !== undefined && !THINKING_LEVELS.has(input.thinkingLevel)) throw commandError('思考档位无效')
    if (input.modelMode !== undefined && !MODEL_MODES.has(input.modelMode)) throw commandError('模型模式无效')
    if (input.contextSwitchMode !== undefined && !CONTEXT_SWITCH_MODES.has(input.contextSwitchMode)) throw commandError('模型上下文切换模式无效')
    if (input.hasAttachments !== undefined && typeof input.hasAttachments !== 'boolean') throw commandError('附件标记无效')

    return {
        sessionId: input.sessionId,
        source: input.source,
        userId: optionalString(input.userId, 256),
        messageId: optionalString(input.messageId, 200) || crypto.randomUUID(),
        content: input.content,
        taskText: optionalString(input.taskText, 100_000),
        permissionMode: input.permissionMode || 'default',
        thinkingLevel: input.thinkingLevel || 'auto',
        modelMode: input.modelMode || 'auto',
        model: optionalString(input.model, 256),
        modelMeta: optionalJsonObject(input.modelMeta),
        contextSwitchMode: input.contextSwitchMode || 'full_history',
        hasAttachments: input.hasAttachments === true,
        noWorkflow: input.noWorkflow === true,
    }
}

function normalizeObserverIdentity(identity = {}) {
    const source = String(identity?.source || '')
    if (source === 'desktop') return {source: 'desktop', userId: null}
    if (!TASK_SOURCES.has(source) || !['wechat', 'feishu', 'dingtalk'].includes(source)) {
        throw commandError('Observer 来源无效')
    }
    const userId = optionalString(identity?.userId, 256)
    if (!userId) throw commandError('IM Observer 缺少用户身份')
    return {source, userId}
}

function assertOpen(closed) {
    if (closed()) throw commandError('Task Command Service 已关闭', 'TASK_COMMAND_SERVICE_CLOSED')
}

export function createTaskCommandService({submit, cancel, onListenerError = () => {}} = {}) {
    if (typeof submit !== 'function' || typeof cancel !== 'function') {
        throw new TypeError('Task Command Service 需要 submit 和 cancel 实现')
    }
    const observers = new Map()
    let closed = false
    const isClosed = () => closed

    return {
        async submitTask(input) {
            assertOpen(isClosed)
            return submit(normalizeTaskCommand(input))
        },

        async cancelTask(sessionId, request = {}) {
            assertOpen(isClosed)
            if (!validSessionId(sessionId)) throw commandError('取消任务缺少有效 Session ID')
            return cancel(sessionId, request && typeof request === 'object' ? {...request} : {})
        },

        observeTask(sessionId, identity, listener) {
            assertOpen(isClosed)
            if (!validSessionId(sessionId)) throw commandError('Observer 缺少有效 Session ID')
            if (typeof listener !== 'function') throw commandError('Observer listener 无效')
            const normalizedIdentity = normalizeObserverIdentity(identity)
            const entry = {identity: normalizedIdentity, listener}
            let entries = observers.get(sessionId)
            if (!entries) observers.set(sessionId, entries = new Set())
            entries.add(entry)
            let disposed = false
            return () => {
                if (disposed) return
                disposed = true
                entries.delete(entry)
                if (entries.size === 0) observers.delete(sessionId)
            }
        },

        publish(sessionId, event, identity = null) {
            if (closed || !validSessionId(sessionId) || !event || typeof event !== 'object') return 0
            const entries = observers.get(sessionId)
            if (!entries?.size) return 0
            let delivered = 0
            for (const entry of [...entries]) {
                if (!shouldDeliverTurnEvent(entry.identity.source, entry.identity.userId, identity)) continue
                try {
                    entry.listener(event)
                    delivered++
                } catch (error) {
                    onListenerError(error, {sessionId, eventType: event.type})
                }
            }
            return delivered
        },

        dispose() {
            if (closed) return
            closed = true
            observers.clear()
        },
    }
}
