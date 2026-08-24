const MAX_TEXT = 12000
const MAX_SUMMARY = 500

function text(value, max = MAX_TEXT) {
    return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function eventType(event) {
    return text(event?.eventType || event?.type, 120)
}

function eventPayload(event) {
    return event?.payload && typeof event.payload === 'object' ? event.payload : {}
}

function questionText(payload, task) {
    return text(payload.requestText || payload.summary || payload.content || payload.text || task.requestText || task.goal || task.summary, MAX_TEXT)
}

/** 从任务事件投影生成用户可追踪的问题列表，不读取 Transcript 正文。 */
export function buildTaskQuestions(task = {}, events = []) {
    const sourceEvents = (Array.isArray(events) ? events : [])
        .filter(event => ['task/created', 'task/input-appended'].includes(eventType(event)))
        .sort((left, right) => Number(left.revision || 0) - Number(right.revision || 0) || Number(left.createdAt || 0) - Number(right.createdAt || 0))
    const effectiveEvents = sourceEvents.length ? sourceEvents : [{
        eventType: 'task/created', revision: 0, createdAt: task.createdAt || task.updatedAt || 0,
        payload: {taskId: task.taskId || task.taskKey, sessionId: task.sessionId, turnId: task.turnId, source: task.source, requestText: task.requestText || task.goal || task.summary},
    }]
    const taskId = text(task.taskId || task.taskKey, 240)
    return effectiveEvents.map((event, index) => {
        const payload = eventPayload(event)
        const value = questionText(payload, task)
        const revision = Number.isFinite(Number(event.revision)) ? Math.max(0, Math.trunc(Number(event.revision))) : index
        return {
            questionId: `${taskId}#${revision}`,
            taskId: text(payload.taskId || taskId, 240),
            sessionId: text(payload.sessionId || task.sessionId, 240) || null,
            sdkSessionId: text(payload.sdkSessionId || task.sdkSessionId, 240) || null,
            historySessionId: text(payload.historySessionId || task.historySessionId || payload.sdkSessionId || task.sdkSessionId, 240) || null,
            turnId: text(payload.turnId || task.turnId, 240) || null,
            source: text(payload.source || task.source || 'desktop', 64) || 'desktop',
            eventType: eventType(event) || 'task/created',
            revision,
            createdAt: Number(event.createdAt || payload.at || task.createdAt || task.updatedAt || 0),
            text: value,
            summary: text(payload.summary || value, MAX_SUMMARY),
        }
    }).filter(item => item.text || item.taskId)
}
