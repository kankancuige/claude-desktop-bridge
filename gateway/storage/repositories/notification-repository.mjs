function required(value, name) {
    const result = String(value || '').trim()
    if (!result) throw Object.assign(new TypeError(`${name} is required`), {code: 'NOTIFICATION_REPOSITORY_ARGUMENT_INVALID'})
    return result
}

/** 任务通知状态端口。业务层只依赖通知意图，不接触通用状态投影。 */
export class NotificationRepository {
    #store
    constructor({stateStore} = {}) {
        if (!stateStore?.listTaskNotificationIntents || !stateStore?.updateTaskNotification
            || !stateStore?.summarizeEntries || !stateStore?.clearEntries) {
            throw new TypeError('Notification state adapter is required')
        }
        this.#store = stateStore
    }

    listPending({platform, limit = 100} = {}) {
        return this.#store.listTaskNotificationIntents(required(platform, 'platform'), {limit})
    }

    updateState({taskId, sessionId = null, platform, notificationId, state, lastError = '', updatedAt} = {}) {
        return this.#store.updateTaskNotification({
            taskId, sessionId, platform: required(platform, 'platform'), notificationId, state, lastError, updatedAt,
        })
    }

    summarize({platform, states} = {}) {
        return this.#store.summarizeEntries('outbox', required(platform, 'platform'), states)
    }

    clearPlatform(platform) {
        const name = required(platform, 'platform')
        return {
            inbox: this.#store.clearEntries('inbox', name),
            notifications: this.#store.clearEntries('outbox', name),
        }
    }
}

export function createNotificationRepository(options = {}) {
    return new NotificationRepository(options)
}
