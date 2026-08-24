export class PitfallRepository {
    #store
    constructor({stateStore} = {}) {
        if (!stateStore?.recordPitfall || !stateStore?.listPitfalls || !stateStore?.updatePitfallStatus) throw new TypeError('Pitfall state adapter is required')
        this.#store = stateStore
    }
    recordOccurrence(record = {}) { return this.#store.recordPitfallOccurrence(record) }
    recordPitfall(record = {}) { return this.#store.recordPitfall(record) }
    countOccurrences(pitfallId) { return this.#store.countPitfallOccurrences(pitfallId) }
    findRelevant({projectKey, limit = 100, statuses = null, scopes = null, now = undefined} = {}) {
        return this.#store.listPitfalls(projectKey, {limit, statuses, scopes, ...(now === undefined ? {} : {now})})
    }
    updateStatus(id, status, options = {}) { return this.#store.updatePitfallStatus(id, status, options) }
    link(record = {}) { return this.#store.linkPitfall(record) }
    get({projectKey, fingerprint, scope = 'project'} = {}) { return this.#store.getPitfall(projectKey, fingerprint, scope) }
    listRecent({limit = 100} = {}) { return this.#store.listRecentPitfalls({limit}) }
}
export function createPitfallRepository(options = {}) { return new PitfallRepository(options) }
