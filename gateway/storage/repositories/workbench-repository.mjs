import {buildTaskQuestions} from '../../tasks/task-questions.mjs'

export class WorkbenchRepository {
    #store
    constructor({stateStore} = {}) {
        if (!stateStore?.getTaskState || !stateStore?.listTaskStates || !stateStore?.recordTaskTransition) throw new TypeError('Workbench state adapter is required')
        this.#store = stateStore
    }
    getTask({projectKey, taskKey, taskId} = {}) {
        const row = this.#store.getTaskState(projectKey, taskKey || taskId)
        return normalizeTask(row, taskEventMetadata(this.#store, projectKey, taskKey || taskId))
    }
    getTaskDetail({projectKey, taskId} = {}) {
        const task = this.getTask({projectKey, taskId})
        if (!task) return null
        const events = this.#store.listTaskEvents ? this.#store.listTaskEvents({projectKey, taskId, limit: 200}) : []
        const normalizedEvents = Array.isArray(events) ? events : []
        return {task, events: normalizedEvents, questions: buildTaskQuestions(task, normalizedEvents), agents: task.state?.coordinator?.agents || {}, workflows: task.state?.coordinator?.workflows || {}, verification: task.state?.coordinator?.verification || task.state?.verification || null, report: this.getReport(taskId)}
    }
    listTaskEvents(options = {}) { return this.#store.listTaskEvents ? this.#store.listTaskEvents(options) : [] }
    listTasks({projectKey = null, activeOnly = false, limit = 100} = {}) {
        return (this.#store.listTaskStates(projectKey, {activeOnly, limit}) || []).map(row => normalizeTask(row, taskEventMetadata(this.#store, row.projectKey || projectKey, row.taskId || row.taskKey)))
    }
    upsertTask(record = {}) { return this.#store.recordTaskTransition(record) }
    appendTaskEvent(record = {}) { return this.#store.appendTaskEvent ? this.#store.appendTaskEvent(record) : false }
    listReports({projectKey = null, limit = 100} = {}) { return this.#store.listExecutionReports(projectKey, {limit}) }
    getReport(taskId) { return this.#store.getExecutionReport(taskId) }
    listPitfalls({projectKey = null, limit = 100} = {}) { return projectKey ? this.#store.listPitfalls(projectKey, {limit}) : this.#store.listRecentPitfalls({limit}) }
    listProjectKeys() { return this.#store.listWorkbenchProjectKeys() }
    listNotificationIntents({platform, limit = 100} = {}) { return this.#store.listTaskNotificationIntents(platform, {limit}) }
    updateNotification(record = {}) { return this.#store.updateTaskNotification(record) }
    getCoordinatorTask({projectKey, taskId} = {}) { return this.#store.getCoordinatorTaskState(projectKey, taskId) }
    upsertVerificationCampaign({projectKey, campaign, updatedAt = Date.now()} = {}) {
        return this.#store.upsertVerificationCampaign({projectKey, campaign, updatedAt})
    }
    listVerificationCampaigns({projectKey, taskId = null, limit = 100} = {}) {
        return this.#store.listVerificationCampaigns(projectKey, {taskId, limit})
    }
}
function taskEventMetadata(store, projectKey, taskId) {
    if (!store?.listTaskEvents || !projectKey || !taskId) return {}
    try {
        const events = store.listTaskEvents({projectKey, taskId, limit: 20})
        if (events && typeof events.then === 'function') return {}
        const created = (Array.isArray(events) ? events : []).find(event => event?.eventType === 'task/created')
        return created?.payload && typeof created.payload === 'object' ? created.payload : {}
    } catch {
        return {}
    }
}

function normalizeTask(row, eventMetadata = {}) {
    if (!row) return null
    const state = row.state && typeof row.state === 'object' ? row.state : {}
    const plan = state.plan && typeof state.plan === 'object' ? state.plan : {}
    const metadata = state.metadata && typeof state.metadata === 'object' ? state.metadata : {}
    const summary = String(row.summary || state.summary || metadata.summary || plan.summary || eventMetadata.summary || state.detail || state.finalReplyText || '').trim().slice(0, 4000)
    const goal = String(row.goal || state.goal || metadata.goal || plan.goal || eventMetadata.goal || '').trim().slice(0, 8000)
    const requestText = String(row.requestText || state.requestText || metadata.requestText || plan.requestText || eventMetadata.requestText || goal || '').trim().slice(0, 12000)
    const rawTitle = String(row.title || state.title || metadata.title || plan.title || eventMetadata.title || '').trim().slice(0, 80)
    const title = readableTaskTitle(rawTitle, summary, goal, requestText)
    return {
        ...row,
        taskId: row.taskId || state.taskId || row.taskKey || null,
        taskKey: row.taskKey || row.taskId || null,
        title, summary, goal, requestText,
        source: row.source || state.source || metadata.source || plan.source || 'desktop',
        projectKey: row.projectKey || state.projectKey || null,
        sessionId: row.sessionId || state.sessionId || null,
        sdkSessionId: row.sdkSessionId || state.sdkSessionId || null,
        historySessionId: row.historySessionId || state.historySessionId || row.sdkSessionId || null,
        turnId: row.turnId || state.turnId || plan.turnId || null,
        phase: row.phase || state.phase || state.status || null,
        createdAt: Number(row.createdAt || state.createdAt || row.startedAt || state.startedAt || row.updatedAt || 0),
        updatedAt: Number(row.updatedAt || state.updatedAt || 0),
        completedAt: row.completedAt || state.completedAt || null,
        execution: row.execution || state.execution || state.coordinator?.execution || null,
        state,
    }
}

function readableTaskTitle(current, summary, goal, requestText) {
    if (current && current !== '未命名任务') return current
    const fallback = [goal, summary, requestText].map(value => String(value || '').trim()).find(Boolean) || ''
    const firstLine = fallback.split(/\r?\n/).map(line => line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+)/, '').trim()).find(Boolean) || ''
    return firstLine.slice(0, 80) || '未命名任务'
}
export function createWorkbenchRepository(options = {}) { return new WorkbenchRepository(options) }
