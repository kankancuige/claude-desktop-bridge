import assert from 'node:assert/strict'
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {readAdapterConfig, migrateAdapterConfig, writeAdapterConfig} from './adapter-config.mjs'

const dir = mkdtempSync(join(tmpdir(), 'bridge-adapter-config-'))
const filePath = join(dir, 'adapters.json')
const keyPath = join(dir, 'key')
const original = {
    wechat: {botToken: 'wechat-secret', baseUrl: 'https://example.test'},
    feishu: {appId: 'cli_test', appSecret: 'feishu-secret'},
}

writeFileSync(filePath, JSON.stringify(original), 'utf8')
const migration = migrateAdapterConfig(filePath, {keyPath})
assert.equal(migration.migrated, true)
assert.deepEqual(migration.config, original)
const encryptedText = readFileSync(filePath, 'utf8')
assert.equal(encryptedText.includes('wechat-secret'), false)
assert.equal(encryptedText.includes('feishu-secret'), false)
assert.deepEqual(readAdapterConfig(filePath, {keyPath}), original)

const updated = {...original, dingtalk: {appKey: 'ding_test', appSecret: 'ding-secret'}}
writeAdapterConfig(filePath, updated, {keyPath})
assert.deepEqual(readAdapterConfig(filePath, {keyPath}), updated)
assert.equal(migrateAdapterConfig(filePath, {keyPath}).migrated, false)

assert.throws(() => readAdapterConfig(filePath, {keyPath: join(dir, 'wrong-key')}))

const protectedFilePath = join(dir, 'protected-adapters.json')
const protectedKeyPath = join(dir, 'protected-key')
writeAdapterConfig(protectedFilePath, original, {keyPath: protectedKeyPath})
rmSync(protectedKeyPath)
assert.throws(() => readAdapterConfig(protectedFilePath, {keyPath: protectedKeyPath}), /key is unavailable/)
assert.equal(existsSync(protectedKeyPath), false)
console.log('adapter-config tests passed')
