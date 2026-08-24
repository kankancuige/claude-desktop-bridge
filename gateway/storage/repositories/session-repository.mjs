function required(value, name) {
    const result = String(value || '').trim()
    if (!result) throw Object.assign(new TypeError(`${name} is required`), {code: 'SESSION_REPOSITORY_ARGUMENT_INVALID'})
    return result
}

export class SessionRepository {
    #store
    constructor({stateStore} = {}) {
        if (!stateStore?.listSessionIndex || !stateStore?.getSessionCatalog || !stateStore?.upsertSessionCatalog) throw new TypeError('Session state adapter is required')
        this.#store = stateStore
    }
    list({projectKey, limit = 100, visibility = null} = {}) { return this.#store.listSessionIndex(required(projectKey, 'projectKey'), {limit, visibility}) }
    listAll({projectKey, limit = 100, visibility = null} = {}) { return this.list({projectKey, limit, visibility}) }
    getMany({projectKey, sessionIds = []} = {}) { return this.#store.getSessionCatalogs(required(projectKey, 'projectKey'), sessionIds.map(value => required(value, 'sessionId'))) }
    get({projectKey, sessionId} = {}) { return this.#store.getSessionCatalog(required(projectKey, 'projectKey'), required(sessionId, 'sessionId')) }
    upsert(record = {}) { return this.#store.upsertSessionCatalog(record) }
    upsertBatch(records = []) { return this.#store.upsertSessionCatalogBatch(records) }
    remove({projectKey, sessionId} = {}) { return this.#store.removeSessionCatalog(required(projectKey, 'projectKey'), required(sessionId, 'sessionId')) }
    removeByTranscriptPath(transcriptPath) { return this.#store.removeSessionIndex(transcriptPath) }
    updateSettings({projectKey, sessionIds = [], patch = {}} = {}) { return this.#store.updateSessionSettingsByIds(required(projectKey, 'projectKey'), sessionIds.map(value => required(value, 'sessionId')), patch) }
}
export function createSessionRepository(options = {}) { return new SessionRepository(options) }
