function required(value, name) {
    const result = String(value || '').trim()
    if (!result) throw Object.assign(new TypeError(`${name} is required`), {code: 'MEMORY_REPOSITORY_ARGUMENT_INVALID'})
    return result
}

/** Memory 领域 port：隐藏 content_documents 的 kind 过滤和底层 SQL 形状。 */
export class MemoryRepository {
    constructor({contentStore} = {}) {
        if (!contentStore?.list || !contentStore?.get || !contentStore?.put || !contentStore?.markUsed) throw new TypeError('Memory content store is required')
        this.contentStore = contentStore
    }

    list({projectKey, status = 'active', limit = 100, after = null, scope} = {}) {
        const args = {projectKey: required(projectKey, 'projectKey'), kind: 'memory', status, limit, after}
        if (scope != null) args.scope = String(scope)
        return this.contentStore.list(args)
    }
    get({projectKey, sourceKey} = {}) { return this.contentStore.get({projectKey: required(projectKey, 'projectKey'), kind: 'memory', sourceKey: required(sourceKey, 'sourceKey')}) }
    put(args = {}) { return this.contentStore.put({...args, projectKey: required(args.projectKey, 'projectKey'), kind: 'memory', sourceKey: required(args.sourceKey, 'sourceKey')}) }
    disable({projectKey, sourceKey, updatedAt} = {}) { return this.contentStore.disable({projectKey: required(projectKey, 'projectKey'), kind: 'memory', sourceKey: required(sourceKey, 'sourceKey'), updatedAt}) }
    remove({projectKey, sourceKey} = {}) { return this.contentStore.remove({projectKey: required(projectKey, 'projectKey'), kind: 'memory', sourceKey: required(sourceKey, 'sourceKey')}) }
    markUsed({projectKey, sourceKey, usedAt} = {}) { return this.contentStore.markUsed({projectKey: required(projectKey, 'projectKey'), kind: 'memory', sourceKey: required(sourceKey, 'sourceKey'), usedAt}) }
    putEmbedding(args = {}) { return this.contentStore.putEmbedding(args) }
    getEmbedding(args = {}) { return this.contentStore.getEmbedding(args) }
    searchSimilar(args = {}) { return this.contentStore.searchSimilar({...args, ...(args.scope != null ? {scope: String(args.scope)} : {})}) }
    removeEmbedding(args = {}) { return this.contentStore.removeEmbedding(args) }
}

export function createMemoryRepository(options = {}) { return new MemoryRepository(options) }
