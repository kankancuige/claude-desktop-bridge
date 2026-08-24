const KIND = 'agent_mailbox'
const PLATFORM = 'bridge'

function clone(value) { return value == null ? value : structuredClone(value) }

/** 复用 state_entries 的结构化持久化端口，不建立第二套协调事实源。 */
export class CoordinationRepository {
    #store
    constructor({stateStore} = {}) {
        if (!stateStore?.loadEntries || !stateStore?.replaceEntries) throw new TypeError('Coordination state adapter is required')
        this.#store = stateStore
    }
    #entries() { return this.#store.loadEntries(KIND, PLATFORM) }
    get(messageId) { return clone(this.#entries().get(String(messageId || '')) || null) }
    put(message) {
        const id = String(message?.messageId || '').trim()
        if (!id) throw new TypeError('Agent messageId is required')
        const entries = this.#entries()
        entries.set(id, clone(message))
        this.#store.replaceEntries(KIND, PLATFORM, entries)
        return clone(message)
    }
    list({toAgent = '', taskId = '', status = null, limit = 100} = {}) {
        const max = Math.max(1, Math.min(1000, Number(limit) || 100))
        return [...this.#entries().values()]
            .filter(item => (!toAgent || item.toAgent === toAgent) && (!taskId || item.taskId === taskId) && (!status || item.status === status))
            .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
            .slice(0, max)
            .map(clone)
    }
}

export function createCoordinationRepository(options = {}) { return new CoordinationRepository(options) }
