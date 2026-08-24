import assert from 'node:assert/strict'
import {mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {boundedTimeout, readPostgresStorageConfig} from './postgres-config.mjs'
import {readStorageConfigFile, storageConfigPath} from './storage-config-file.mjs'

test('未配置后端时明确要求 PostgreSQL', () => {
    assert.throws(() => readPostgresStorageConfig({}), error => error.code === 'STORAGE_BACKEND_REQUIRED')
})

test('PostgreSQL 配置只接受本机地址并脱敏连接串', () => {
    const result = readPostgresStorageConfig({BRIDGE_STORAGE_BACKEND: 'postgres', BRIDGE_POSTGRES_URL: 'postgresql://postgres:123456@127.0.0.1:5432/postgres', BRIDGE_POSTGRES_SCHEMA: 'bridge_state'})
    assert.equal(result.enabled, true)
    assert.equal(result.mode, 'postgres')
    assert.equal(result.schema, 'bridge_state')
    assert.match(result.safeConnectionString, /redacted/)
    assert.doesNotMatch(result.safeConnectionString, /123456/)
})

test('PostgreSQL 远程地址和非法后端被拒绝', () => {
    assert.throws(() => readPostgresStorageConfig({BRIDGE_STORAGE_BACKEND: 'postgres', BRIDGE_POSTGRES_URL: 'postgres://u:p@db.example/postgres'}), error => error.code === 'STORAGE_POSTGRES_HOST_NOT_LOCAL')
    assert.throws(() => readPostgresStorageConfig({BRIDGE_STORAGE_BACKEND: 'mysql'}), error => error.code === 'STORAGE_BACKEND_INVALID')
})

test('查询超时被限制在 1 到 10 秒', () => {
    assert.equal(boundedTimeout('500'), 1000)
    assert.equal(boundedTimeout('20000'), 10000)
    assert.equal(boundedTimeout('bad'), 3000)
})

test('从 Bridge 私有配置文件读取 PostgreSQL 连接并支持环境覆盖', () => {
    const home = mkdtempSync(join(tmpdir(), 'bridge-storage-config-'))
    writeFileSync(storageConfigPath(home), JSON.stringify({
        backend: 'postgres',
        postgres: {connectionString: 'postgresql://postgres:123456@127.0.0.1:5432/postgres', schema: 'bridge', statementTimeoutMs: 4000},
        memory: {embeddingDimensions: 768},
    }))
    const result = readStorageConfigFile({bridgeHome: home, env: {}})
    assert.equal(result.source, 'file')
    assert.equal(result.config.enabled, true)
    assert.equal(result.config.statementTimeoutMs, 4000)
    assert.equal(result.config.memory.embeddingDimensions, 768)
    assert.match(result.config.safeConnectionString, /redacted/)
    const overridden = readStorageConfigFile({bridgeHome: home, env: {BRIDGE_POSTGRES_SCHEMA: 'bridge_test'}})
    assert.equal(overridden.source, 'file+environment')
    assert.equal(overridden.config.schema, 'bridge_test')
    const endpointCleared = readStorageConfigFile({bridgeHome: home, env: {BRIDGE_MEMORY_EMBEDDING_ENDPOINT: ''}})
    assert.equal(endpointCleared.config.memory.embeddingEndpoint, '')
})

test('配置文件缺失或损坏时返回稳定错误码', () => {
    const home = mkdtempSync(join(tmpdir(), 'bridge-storage-config-'))
    assert.throws(() => readStorageConfigFile({bridgeHome: home}), error => error.code === 'STORAGE_CONFIG_FILE_MISSING')
    writeFileSync(storageConfigPath(home), '{')
    assert.throws(() => readStorageConfigFile({bridgeHome: home}), error => error.code === 'STORAGE_CONFIG_FILE_INVALID')
    writeFileSync(storageConfigPath(home), JSON.stringify({backend: 'postgres', postgres: 'invalid'}))
    assert.throws(() => readStorageConfigFile({bridgeHome: home}), error => error.code === 'STORAGE_CONFIG_FILE_INVALID')
})

test('配置文件必须使用绝对 Bridge 私有目录', () => {
    assert.throws(() => storageConfigPath('relative-bridge-home'), error => error.code === 'STORAGE_CONFIG_HOME_NOT_ABSOLUTE')
})
