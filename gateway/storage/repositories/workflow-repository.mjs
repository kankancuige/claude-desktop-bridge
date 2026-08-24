export class WorkflowRepository {
    #store
    constructor({stateStore} = {}) {
        if (!stateStore?.upsertWorkflowState || !stateStore?.listWorkflowStates) throw new TypeError('Workflow state adapter is required')
        this.#store = stateStore
    }
    get available() { return Boolean(this.#store?.available) }
    upsert(record = {}) { return this.#store.upsertWorkflowState(record) }
    list({projectKey, parentSessionId = null, limit = 100} = {}) {
        return this.#store.listWorkflowStates(projectKey, {parentSessionId, limit})
    }
}
export function createWorkflowRepository(options = {}) { return new WorkflowRepository(options) }
