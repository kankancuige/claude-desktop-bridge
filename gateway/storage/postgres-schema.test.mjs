import assert from 'node:assert/strict'
import test from 'node:test'
import {ensurePostgresSchema, identifier, normalizeVectorDimensions, schemaCommentDefinitions, schemaCommentSql, schemaSql} from './postgres-schema.mjs'

test('schema SQL 使用受限标识符且不自动安装扩展', () => {
    const sql = schemaSql('bridge_state')
    assert.match(sql, /CREATE SCHEMA IF NOT EXISTS "bridge_state"/)
    assert.doesNotMatch(sql, /CREATE EXTENSION/i)
    assert.throws(() => identifier('bridge-state'), error => error.code === 'STORAGE_IDENTIFIER_INVALID')
})

test('所有 PostgreSQL 表和字段都有详细中文注释', () => {
    const sql = schemaCommentSql('bridge', {includeVector: true})
    for (const [table, definition] of Object.entries(schemaCommentDefinitions)) {
        assert.match(sql, new RegExp(`COMMENT ON TABLE "bridge"\\."${table}" IS`))
        for (const column of Object.keys(definition.columns)) {
            assert.match(sql, new RegExp(`COMMENT ON COLUMN "bridge"\\."${table}"\\."${column}" IS`))
        }
    }
    assert.ok(Object.keys(schemaCommentDefinitions).length >= 13)
    assert.ok(sql.includes('统一任务生命周期当前状态表'))
    assert.ok(sql.includes('缓存读取 token 数'))
})

test('无 pgvector 时 capability 明确为 false，重复迁移可执行', async () => {
    const calls = []
    const client = {query: async (text) => {
        calls.push(text)
        if (text.startsWith('SELECT EXISTS')) return {rows: [{enabled: false}]}
        if (text.startsWith('SELECT version')) return {rows: [{version: 1}]}
        return {rows: []}
    }}
    const result = await ensurePostgresSchema(client, {schema: 'bridge'})
    assert.deepEqual(result, {schema: 'bridge', migrationVersion: 1, vectorEnabled: false})
    assert.equal(calls.filter(value => value.includes('CREATE TABLE IF NOT EXISTS')).length, 1)
})

test('检测到 pgvector 时创建受控维度向量列', async () => {
    const calls = []
    const client = {query: async text => {
        calls.push(text)
        if (text.startsWith('SELECT EXISTS')) return {rows: [{enabled: true}]}
        if (text.startsWith('SELECT version')) return {rows: [{version: 1}]}
        return {rows: []}
    }}
    const result = await ensurePostgresSchema(client, {schema: 'bridge', vectorDimensions: 768})
    assert.equal(result.vectorEnabled, true)
    assert.equal(result.vectorDimensions, 768)
    assert.ok(calls.some(value => value.includes('embedding vector(768)')))
    assert.equal(normalizeVectorDimensions(768), 768)
    assert.throws(() => normalizeVectorDimensions(0), error => error.code === 'STORAGE_VECTOR_DIMENSIONS_INVALID')
})
