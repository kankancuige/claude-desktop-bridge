function required(value, name) {
    const result = String(value || '').trim()
    if (!result) throw Object.assign(new TypeError(`${name} is required`), {code: 'IM_REPOSITORY_ARGUMENT_INVALID'})
    return result
}

export class ImRepository {
    #store
    constructor({stateStore} = {}) {
        if (!stateStore?.loadEntries || !stateStore?.replaceEntries || !stateStore?.clearEntries || !stateStore?.summarizeEntries) throw new TypeError('IM state adapter is required')
        this.#store = stateStore
    }
    loadEntries({kind, platform} = {}) { return this.#store.loadEntries(required(kind, 'kind'), required(platform, 'platform')) }
    replaceEntries({kind, platform, entries} = {}) { return this.#store.replaceEntries(required(kind, 'kind'), required(platform, 'platform'), entries) }
    clearEntries({kind, platform} = {}) { return this.#store.clearEntries(required(kind, 'kind'), required(platform, 'platform')) }
    summarizeEntries({kind, platform, states} = {}) { return this.#store.summarizeEntries(required(kind, 'kind'), required(platform, 'platform'), states) }
}
export function createImRepository(options = {}) { return new ImRepository(options) }
