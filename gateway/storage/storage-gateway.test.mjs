import assert from 'node:assert/strict'
import test from 'node:test'
import {createStorageGateway} from './storage-gateway.mjs'

function fakeClient() {
    const calls = []
    return {
        calls,
        async connect() { calls.push(['connect']) },
        async query(text, values) {
            calls.push(['query', text, values])
            if (text.startsWith('SELECT current_database')) return {rows: [{database: 'postgres', server_version: '17.11'}]}
            return {rows: []}
        },
        async end() { calls.push(['end']) },
    }
}

test('统一入口使用参数化查询并设置 statement timeout', async () => {
    const fake = fakeClient()
    const gateway = createStorageGateway({config: {enabled: true, mode: 'postgres', connectionString: 'postgres://local', schema: 'bridge', statementTimeoutMs: 3000}, clientFactory: async () => fake})
    const result = await gateway.health()
    assert.equal(result.healthy, true)
    await gateway.query('SELECT $1::text AS value', ['ok'])
    assert.deepEqual(fake.calls[1], ['query', "SELECT set_config('statement_timeout', $1::text, false)", ['3000']])
    assert.deepEqual(fake.calls[2], ['query', 'SELECT current_database() AS database, current_setting($1) AS server_version', ['server_version']])
    await gateway.close()
})

test('事务失败回滚，且不吞掉业务错误', async () => {
    const fake = fakeClient()
    const gateway = createStorageGateway({config: {enabled: true, mode: 'postgres', connectionString: 'postgres://local', schema: 'bridge', statementTimeoutMs: 3000}, clientFactory: async () => fake})
    await assert.rejects(() => gateway.transaction(async client => {
        await client.query('INSERT INTO bridge.test(value) VALUES ($1)', ['x'])
        throw new Error('business-failure')
    }), /business-failure/)
    assert.ok(fake.calls.some(call => call[1] === 'ROLLBACK'))
    await gateway.close()
})

test('未启用 PostgreSQL 时统一入口明确报告未启用', async () => {
    const gateway = createStorageGateway({config: {enabled: false, mode: 'postgres', connectionString: null, schema: 'bridge', statementTimeoutMs: 3000}})
    assert.deepEqual(await gateway.health(), {mode: 'postgres', healthy: false, reason: 'postgres_not_enabled'})
    await assert.rejects(() => gateway.query('SELECT 1'), error => error.code === 'STORAGE_POSTGRES_NOT_ENABLED')
})

test('统一入口暴露内容仓储，不让调用方自行拼接数据库或文件路径', () => {
    const gateway = createStorageGateway({config: {enabled: true, mode: 'postgres', connectionString: 'postgres://local', schema: 'bridge', statementTimeoutMs: 3000}, clientFactory: async () => fakeClient()})
    assert.equal(typeof gateway.content.put, 'function')
    assert.equal(gateway.db, gateway)
})

test('StorageGateway 可在状态加载后组装领域 repositories', () => {
    const gateway = createStorageGateway({config: {enabled: true, mode: 'postgres', connectionString: 'postgres://local', schema: 'bridge', statementTimeoutMs: 3000}, clientFactory: async () => fakeClient()})
    const stateStore = {
        listSessionIndex: () => [], getSessionCatalog: () => null, upsertSessionCatalog: value => value, upsertSessionCatalogBatch: () => true, removeSessionCatalog: () => true, updateSessionSettingsByIds: () => true,
        listWorkbenchProjectKeys: () => [], getTaskState: () => null, listTaskStates: () => [], recordTaskTransition: () => true, listExecutionReports: () => [], getExecutionReport: () => null, listPitfalls: () => [], listRecentPitfalls: () => [],
        recordPitfall: () => ({}), recordPitfallOccurrence: () => true, updatePitfallStatus: () => true, linkPitfall: () => true, getPitfall: () => null,
        loadEntries: () => new Map(), replaceEntries: () => true, clearEntries: () => 0, summarizeEntries: () => ({}),
    }
    const repositories = gateway.attachStateRepositories(stateStore)
    assert.equal(typeof repositories.session.list, 'function')
    assert.equal(typeof repositories.project.listKeys, 'function')
    assert.equal(typeof repositories.workbench.listTasks, 'function')
    assert.equal(typeof repositories.pitfall.findRelevant, 'function')
    assert.equal(typeof repositories.im.loadEntries, 'function')
})

test('连接断开后清理旧 client，下一次查询重新连接', async () => {
    const clients = []
    const clientFactory = async () => {
        const client = fakeClient()
        client.connect = async () => { client.calls.push(['connect']); if (clients.length === 0) clients.push(client) }
        const originalQuery = client.query
        client.query = async (text, values) => {
            if (text === 'SELECT fail') throw Object.assign(new Error('socket closed'), {code: 'ECONNRESET'})
            return originalQuery(text, values)
        }
        clients.push(client)
        return client
    }
    const gateway = createStorageGateway({config: {enabled: true, mode: 'postgres', connectionString: 'postgres://local', schema: 'bridge', statementTimeoutMs: 3000}, clientFactory})
    await assert.rejects(() => gateway.query('SELECT fail'), error => error.code === 'STORAGE_POSTGRES_DISCONNECTED')
    assert.equal(gateway.client, null)
    await gateway.query('SELECT 1')
    assert.equal(clients.length >= 2, true)
    await gateway.close()
})

test('PostgreSQL statement timeout 返回稳定错误码', async () => {
    const fake = fakeClient()
    const originalQuery = fake.query
    fake.query = async (text, values) => {
        if (text === 'SELECT timeout') throw Object.assign(new Error('canceling statement'), {code: '57014'})
        return originalQuery(text, values)
    }
    const gateway = createStorageGateway({config: {enabled: true, mode: 'postgres', connectionString: 'postgres://local', schema: 'bridge', statementTimeoutMs: 3000}, clientFactory: async () => fake})
    await assert.rejects(() => gateway.query('SELECT timeout'), error => error.code === 'STORAGE_POSTGRES_TIMEOUT')
    await gateway.close()
})
