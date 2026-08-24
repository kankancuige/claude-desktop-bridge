function clone(value) {
    return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
}

function validateId(id) {
    const value = String(id || '').trim()
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(value)) throw Object.assign(new TypeError('scheduled task id invalid'), {code: 'SCHEDULED_TASK_INVALID'})
    return value
}

function normalizeTask(task = {}) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) throw Object.assign(new TypeError('scheduled task must be an object'), {code: 'SCHEDULED_TASK_INVALID'})
    const result = {
        cron: String(task.cron || '').trim(),
        prompt: String(task.prompt || ''),
        workDir: String(task.workDir || '').trim(),
        model: typeof task.model === 'string' ? task.model.slice(0, 256) : '',
        permissionMode: typeof task.permissionMode === 'string' ? task.permissionMode : 'default',
        maxTurns: Math.min(100, Math.max(1, Number(task.maxTurns) || 20)),
        enabled: task.enabled !== false,
    }
    if (task.sessionId) result.sessionId = String(task.sessionId).slice(0, 256)
    if (task.thinkingLevel) result.thinkingLevel = String(task.thinkingLevel).slice(0, 64)
    if (result.cron.length > 128 || !result.prompt.trim() || result.prompt.length > 20_000 || !result.workDir || result.workDir.length > 2_000) {
        throw Object.assign(new TypeError('scheduled task definition invalid'), {code: 'SCHEDULED_TASK_INVALID'})
    }
    return result
}

/** 定时任务持久化端口；Scheduler 不持有 JSON 路径或可变配置对象。 */
export function createScheduledTaskStore({readJSON, writeJSON, path} = {}) {
    if (typeof readJSON !== 'function' || typeof writeJSON !== 'function' || !path) throw new TypeError('scheduled task store dependencies are required')
    const loaded = readJSON(path)
    const tasks = new Map()
    for (const [id, task] of Object.entries(loaded && typeof loaded === 'object' ? loaded : {})) {
        try { tasks.set(validateId(id), normalizeTask(task)) } catch { /* 损坏条目不阻断其他任务恢复 */ }
    }

    function snapshot() {
        return Object.fromEntries([...tasks].map(([id, task]) => [id, clone(task)]))
    }
    function persist() {
        writeJSON(path, snapshot())
    }
    function list() { return snapshot() }
    function get(id) {
        const value = tasks.get(validateId(id))
        return value ? clone(value) : null
    }
    function upsert(id, task) {
        const key = validateId(id)
        const value = normalizeTask(task)
        const previous = tasks.get(key) ? clone(tasks.get(key)) : null
        tasks.set(key, value)
        try { persist() } catch (error) {
            if (previous) tasks.set(key, previous)
            else tasks.delete(key)
            throw error
        }
        return clone(value)
    }
    function remove(id) {
        const key = validateId(id)
        const previous = tasks.get(key)
        if (!previous) return false
        tasks.delete(key)
        try { persist() } catch (error) {
            tasks.set(key, previous)
            throw error
        }
        return true
    }
    return Object.freeze({list, get, upsert, remove})
}
