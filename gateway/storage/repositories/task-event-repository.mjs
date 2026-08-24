export class TaskEventRepository {
    #store
    constructor({stateStore} = {}) {
        if (!stateStore?.listTaskEvents) throw new TypeError('Task event state adapter is required')
        this.#store = stateStore
    }
    list(options = {}) {
        const events = this.#store.listTaskEvents(options)
        return (Array.isArray(events) ? events : []).slice().sort((left, right) => Number(left.revision || 0) - Number(right.revision || 0) || Number(left.createdAt || 0) - Number(right.createdAt || 0))
    }
}
export function createTaskEventRepository(options = {}) { return new TaskEventRepository(options) }
