import {createImTurnTimeout} from './im-turn-timeout.mjs'
import {turnFallbackText} from './im-turn-finish.mjs'

const TERMINAL_TYPES = new Set([
    'task_completed', 'task_failed', 'task_review_paused', 'task_verification_inconclusive',
])

function assistantText(message) {
    const parts = []
    for (const block of message?.content || []) {
        if (block?.type === 'text' && block.text) parts.push(block.text)
    }
    return parts.join('\n')
}

function rejectionReason(result) {
    if (result?.type === 'message_duplicate') return 'duplicate'
    if (result?.type !== 'message_rejected') return null
    return result.code === 'input_queue_full' ? 'queue_full' : 'invalid_input'
}

/**
 * 在进程内提交一次 IM 任务并消费所属回合事件。平台适配器只负责消息收发。
 */
export async function runImTask({
    taskCommands,
    sessionId,
    source,
    userId,
    content,
    messageId = '',
    signal,
    loadMirror = async () => false,
    onPermission = async () => {},
    onChoice = async () => {},
    onConfirmationResolved = async () => {},
    onStopped = async () => {},
    onFinish = async () => {},
    onError = () => {},
    completionDelayMs = 500,
    timeoutOptions = {},
} = {}) {
    if (!taskCommands || typeof taskCommands.submitTask !== 'function' || typeof taskCommands.observeTask !== 'function') {
        throw new TypeError('runImTask 需要 TaskCommandService')
    }
    if (typeof onFinish !== 'function') throw new TypeError('onFinish 必须是函数')

    let done = false
    let accepted = false
    let expectedTurnId = null
    let replyText = ''
    let toolCount = 0
    let terminalNotificationId = null
    let completionTimer = null
    let timeoutTriggered = false
    let completionReason = ''
    let disposeObserver = () => {}
    let resolveDone
    const bufferedEvents = []
    const mirrorPromise = Promise.resolve()
        .then(loadMirror)
        .then(Boolean)
        .catch(error => {
            onError(error, {phase: 'mirror'})
            return false
        })
    const donePromise = new Promise(resolve => { resolveDone = resolve })

    const finish = async (reason, error = null) => {
        if (done) return
        done = true
        completionReason = reason
        turnTimeout.stop()
        disposeObserver()
        if (completionTimer) clearTimeout(completionTimer)
        signal?.removeEventListener?.('abort', abortHandler)
        const mirrorEnabled = await mirrorPromise
        try {
            await onFinish({
                reason,
                error,
                replyText: replyText.trim() || turnFallbackText(reason),
                toolCount,
                notificationId: terminalNotificationId,
                mirrorEnabled,
                turnId: expectedTurnId,
            })
        } catch (finishError) {
            onError(finishError, {phase: 'finish', reason})
        } finally {
            resolveDone({reason, turnId: expectedTurnId, toolCount, replyText, mirrorEnabled})
        }
    }

    const turnTimeout = createImTurnTimeout({
        ...timeoutOptions,
        onTimeout: () => {
            timeoutTriggered = true
            void (async () => {
                try {
                    await taskCommands.cancelTask?.(sessionId, {source, userId, reason: 'im_timeout'})
                } catch (error) {
                    onError(error, {phase: 'timeout_cancel'})
                }
                await finish('timeout')
            })()
        },
    })

    const handleEvent = async event => {
        if (done || !event || typeof event !== 'object') return
        turnTimeout.touch()
        if (!accepted) {
            bufferedEvents.push(event)
            return
        }
        if (expectedTurnId && event.turnId && event.turnId !== expectedTurnId) return
        const mirrorEnabled = await mirrorPromise

        if (event.type === 'assistant_message') {
            replyText = assistantText(event.message)
        } else if (event.type === 'text_delta' && event.text) {
            replyText += event.text
        } else if (event.type === 'tool_use_start') {
            toolCount++
        } else if (event.type === 'permission_request') {
            if (!mirrorEnabled) await onPermission(event)
        } else if (event.type === 'choice_request') {
            if (!mirrorEnabled) await onChoice(event)
        } else if (event.type === 'confirmation_resolved') {
            await onConfirmationResolved(event, {mirrorEnabled})
        } else if (TERMINAL_TYPES.has(event.type)) {
            terminalNotificationId = event.notificationId || terminalNotificationId
            if (event.reply) replyText = String(event.reply)
            if (event.detail && event.type !== 'task_completed') {
                replyText = [replyText.trim(), `[Bridge] ${event.detail}`].filter(Boolean).join('\n\n')
            }
            if (event.type === 'task_completed' && completionDelayMs > 0) {
                completionTimer = setTimeout(() => { void finish(event.type) }, completionDelayMs)
                completionTimer?.unref?.()
            } else {
                await finish(event.type)
            }
        } else if (event.type === 'generation_stopped') {
            if (timeoutTriggered) return
            await onStopped(event)
            await finish('stopped')
        } else if (event.type === 'error') {
            await finish('runtime_error', event)
        }
    }

    let eventChain = Promise.resolve()
    disposeObserver = taskCommands.observeTask(sessionId, {source, userId}, event => {
        eventChain = eventChain
            .then(() => handleEvent(event))
            .catch(error => {
                onError(error, {phase: 'observer', eventType: event?.type})
                return finish('observer_error', error)
            })
    })

    const abortHandler = () => { void finish('adapter_stopped') }
    if (signal?.aborted) {
        await finish('adapter_stopped')
        return donePromise
    }
    signal?.addEventListener?.('abort', abortHandler, {once: true})

    let submission
    try {
        submission = await taskCommands.submitTask({
            sessionId, source, userId, messageId, content, permissionMode: 'default',
        })
    } catch (error) {
        onError(error, {phase: 'submit'})
        await finish('submit_error', error)
        return donePromise
    }

    const rejected = rejectionReason(submission)
    if (rejected) {
        await finish(rejected)
        return donePromise
    }
    if (submission?.type !== 'message_accepted' || !submission.turnId) {
        const error = new Error('任务提交未返回有效 accepted 结果')
        onError(error, {phase: 'submit_result'})
        await finish('submit_error', error)
        return donePromise
    }

    if (done) {
        try {
            await taskCommands.cancelTask?.(sessionId, {
                source, userId, reason: `im_${completionReason || 'owner_lost'}_after_submit`,
            })
        } catch (error) {
            onError(error, {phase: 'post_submit_cancel', reason: completionReason})
        }
        return donePromise
    }

    expectedTurnId = submission.turnId
    accepted = true
    for (const event of bufferedEvents.splice(0)) {
        eventChain = eventChain.then(() => handleEvent(event))
    }
    return donePromise
}
