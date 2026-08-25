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
    count({projectKey, status = 'active', scope} = {}) {
        if (typeof this.contentStore.count === 'function') return this.contentStore.count({projectKey: required(projectKey, 'projectKey'), kind: 'memory', status, scope})
        return this.list({projectKey, status, scope, limit: 500}).then(rows => rows.length)
    }
    listChildren({projectKey, parentKey, status = 'active', limit = 100, after = null, scope} = {}) {
        const args = {projectKey: required(projectKey, 'projectKey'), parentKey: required(parentKey, 'parentKey'), kind: 'memory', status, limit, after}
        if (scope != null) args.scope = String(scope)
        if (typeof this.contentStore.listChildren === 'function') return this.contentStore.listChildren(args)
        return Promise.resolve(this.list({projectKey: args.projectKey, status, limit: 500, scope})).then(rows => rows.filter(row => row.metadata?.parentKey === args.parentKey).slice(0, Math.max(1, Math.min(500, Number(limit) || 100))))
    }
    load({projectKey, sourceKey, tier = 'l2'} = {}) {
        const project = required(projectKey, 'projectKey')
        const source = required(sourceKey, 'sourceKey')
        if (typeof this.contentStore.load === 'function') return this.contentStore.load({projectKey: project, kind: 'memory', sourceKey: source, tier})
        return Promise.resolve(this.get({projectKey: project, sourceKey: source})).then(row => {
            if (!row) return null
            const selectedTier = ['l0', 'l1', 'l2'].includes(String(tier).toLowerCase()) ? String(tier).toLowerCase() : 'l2'
            const selectedBody = selectedTier === 'l0' ? row.metadata?.l0 || row.body : selectedTier === 'l1' ? row.metadata?.l1 || row.body : row.body
            return {...row, selectedTier, selectedBody: String(selectedBody || '')}
        })
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
