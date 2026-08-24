function required(value, name) {
    const result = String(value || '').trim()
    if (!result) throw Object.assign(new TypeError(`${name} is required`), {code: 'PROJECT_REPOSITORY_ARGUMENT_INVALID'})
    return result
}

export class ProjectRepository {
    #store
    constructor({stateStore} = {}) {
        if (!stateStore?.listWorkbenchProjectKeys || !stateStore?.listSessionIndex) throw new TypeError('Project state adapter is required')
        this.#store = stateStore
    }
    listKeys() { return this.#store.listWorkbenchProjectKeys() }
    listTranscripts({projectKey, limit = 100, visibility = null} = {}) { return this.#store.listSessionIndex(required(projectKey, 'projectKey'), {limit, visibility}) }
    reconcile({records = []} = {}) { return this.#store.upsertSessionCatalogBatch(records) }
}
export function createProjectRepository(options = {}) { return new ProjectRepository(options) }
