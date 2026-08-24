import {createPostgresStateCompat} from '../storage/postgres-state-compat.mjs'

/**
 * 单元测试使用的 PostgreSQL 状态投影替身：保留同步业务 API，记录所有异步落库意图，
 * 不依赖本机数据库，也不引入第二种持久化实现。
 */
export function createPostgresStateFixture() {
    const calls = []
    const gateway = {
        calls,
        state: {
            replaceEntries: async (...args) => { calls.push(['replaceEntries', ...args]); return true },
            recordTaskTransition: async value => { calls.push(['task', value]); return true },
            appendModelUsageEvent: async value => { calls.push(['usage', value]); return true },
        },
        content: {
            put: async value => { calls.push(['content.put', value]); return value },
            remove: async value => { calls.push(['content.remove', value]); return true },
            disable: async value => { calls.push(['content.disable', value]); return true },
        },
        query: async (sql, values = []) => {
            calls.push(['query', sql, values])
            if (sql.includes('schema_version')) return {rows: [{version: 1}]}
            return {rows: []}
        },
    }
    return {store: createPostgresStateCompat({gateway}), gateway}
}
