#!/usr/bin/env node
import process from 'node:process'

function text(value, max = 4000) { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
function opaqueId(value) { const normalized = text(value, 240).replace(/:coordinator$/, ''); return /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(normalized) || /^[0-9a-f]{32,}$/i.test(normalized) || /^[0-9a-f]{16,}:[0-9a-f-]{8,}$/i.test(normalized) }

export function projectTaskMetadata(task = {}) {
    const state = task.state && typeof task.state === 'object' ? task.state : {}
    const plan = state.plan && typeof state.plan === 'object' ? state.plan : {}
    const existingTitle = text(task.title, 80)
    const title = (existingTitle && !opaqueId(existingTitle) ? existingTitle : text(state.title || plan.title || plan.goal || state.goal || '', 80)) || '未命名任务'
    const summary = text(task.summary || state.summary || plan.summary || state.detail || state.finalReplyText || '', 4000)
    const goal = text(task.goal || state.goal || plan.goal || '', 8000)
    const requestText = text(task.requestText || state.requestText || plan.requestText || goal, 12000)
    return {title, summary, goal, requestText, source: text(task.source || state.source || plan.source || 'desktop', 64) || 'desktop'}
}

export async function backfillWorkbenchTaskMetadata({repository, projectKey = null, dryRun = true, limit = 500, logger = console} = {}) {
    if (!repository?.listTasks) throw new TypeError('Workbench Repository is required')
    const tasks = repository.listTasks({projectKey, limit}) || []
    const candidates = tasks.map(task => ({task, metadata: projectTaskMetadata(task)})).filter(item => !text(item.task.title) || opaqueId(item.task.title) || !text(item.metadata.summary) || !text(item.metadata.requestText))
    const report = {dryRun, candidateCount: candidates.length, updatedCount: 0, missingFields: {}, projected: candidates.map(item => ({taskId: item.task.taskId, title: item.metadata.title}))}
    for (const {task, metadata} of candidates) {
        for (const field of ['title', 'summary', 'requestText']) if (!text(task[field])) report.missingFields[field] = (report.missingFields[field] || 0) + 1
        if (dryRun) continue
        let lastError = null
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                const nextMetadata = {
                    ...metadata,
                    title: text(task.title) && !opaqueId(task.title) ? text(task.title, 80) : metadata.title,
                    summary: text(task.summary) || metadata.summary,
                    goal: text(task.goal) || metadata.goal,
                    requestText: text(task.requestText) || metadata.requestText,
                }
                const changed = await repository.upsertTask({...task, state: {...(task.state || {}), ...nextMetadata}, ...nextMetadata, revision: Number(task.revision || 0) + 1, updatedAt: Date.now(), eventType: 'task/metadata-backfilled', eventPayload: {taskId: task.taskId, ...nextMetadata}})
                if (changed !== false) report.updatedCount += 1
                lastError = null
                break
            } catch (error) {
                lastError = error
                if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
            }
        }
        if (lastError) {
            report.failures = report.failures || []
            report.failures.push({taskId: task.taskId, error: text(lastError?.message || lastError, 300)})
            logger.error?.({taskId: task.taskId, err: lastError}, '任务元数据回填失败')
        }
    }
    return report
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
    const dryRun = !process.argv.includes('--write')
    process.stdout.write(JSON.stringify({dryRun, message: '请从 Gateway 注入 Workbench Repository 后执行回填'}, null, 2) + '\n')
}
