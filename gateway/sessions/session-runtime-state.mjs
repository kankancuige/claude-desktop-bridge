export function getSessionRuntimeState(session) {
    const pendingInputs = Array.isArray(session?._pendingInputs) ? session._pendingInputs.length : 0
    const pendingMessages = Array.isArray(session?._pendingMessages) ? session._pendingMessages.length : 0
    return {
        permissionMode: ['default', 'acceptEdits', 'plan', 'bypassPermissions'].includes(session?.permissionMode)
            ? session.permissionMode
            : 'default',
        runtimeReady: Boolean(session?.query && session?.pushStream),
        running: Boolean(session?.query && session?.pushStream),
        generating: Boolean(session?._generating || pendingInputs || pendingMessages || session?._rebuildPromise),
        pendingInputs,
        pendingConfirmations: summarizePendingConfirmations(session),
    }
}

/**
 * 部分 Provider 在 PushStream 输入后只发 result，不回传对应的 user 事件。
 * 此时 result 是该输入已被执行的唯一确认；仅在没有已激活回合时消费队首，
 * 避免将下一条补充指令误认为当前回合已完成。
 */
export function consumePendingSessionInputOnResult(session) {
    return consumeTaskInput(session, {onlyWhenIdle: true})
}

function summarizePendingConfirmations(session) {
    const pending = session?.pending
    if (!pending || typeof pending.values !== 'function') return []
    return [...pending.values()].filter(entry => !entry?.settled).slice(0, 20).map(entry => ({
        requestId: String(entry.requestId || entry.id || '').slice(0, 200),
        type: entry.type === 'choice' ? 'choice' : 'permission',
        toolName: String(entry.toolName || '').slice(0, 200),
        turnId: String(entry.turnId || '').slice(0, 200) || null,
        source: String(entry.source || 'desktop').slice(0, 40),
        userId: String(entry.userId || '').slice(0, 200) || null,
        expiresAt: Number(entry.expiresAt || 0),
        question: entry.type === 'choice' ? String(entry.questions?.[0]?.question || '').slice(0, 1000) : '',
        options: entry.type === 'choice' ? (Array.isArray(entry.questions?.[0]?.options) ? entry.questions[0].options.slice(0, 20).map(option => ({label: String(option?.label || '').slice(0, 300)})) : []) : [],
    }))
}
import {consumeTaskInput} from './task-input-queue.mjs'
