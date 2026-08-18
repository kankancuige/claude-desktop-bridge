import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, unlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {BridgeStateDb} from '../storage/bridge-state-db.mjs'
import {createMemoryService} from './memory-service.mjs'

function fixture() {
    const home = mkdtempSync(join(tmpdir(), 'bridge-memory-'))
    const encodedDir = 'D--demo'
    mkdirSync(join(home, 'projects', encodedDir, 'memory'), {recursive: true})
    writeFileSync(join(home, 'projects', encodedDir, 'memory', 'conventions.md'), '# 编码约定\n所有源文件使用 UTF-8，注释使用简体中文。\napi_key=should-not-leak\n', 'utf8')
    const db = new BridgeStateDb({bridgeHome: home})
    const service = createMemoryService({bridgeHome: home, stateStore: db})
    return {home, db, service, encodedDir}
}

test('普通问题不召回 Memory，动作任务只召回关键词匹配内容并脱敏', t => {
    const {db, service, encodedDir} = fixture()
    t.after(() => db.close())
    assert.equal(service.retrieve({workDir: 'D:\\demo', encodedDir, text: '你好，什么是 UTF-8？'}).text, '')
    const result = service.retrieve({workDir: 'D:\\demo', encodedDir, text: '修改代码并统一使用 UTF-8 编码'})
    assert.match(result.text, /编码约定/)
    assert.match(result.text, /UTF-8/)
    assert.doesNotMatch(result.text, /should-not-leak/)
    assert.equal(result.items.length, 1)
    assert.equal(service.retrieve({workDir: 'D:\\demo', encodedDir, text: '修改中文注释'}).items.length, 1)
})

test('Memory 索引刷新可处理删除和禁用', t => {
    const {home, db, service, encodedDir} = fixture()
    t.after(() => db.close())
    service.refreshProject({workDir: 'D:\\demo', encodedDir})
    assert.equal(service.list({encodedDir}).length, 1)
    assert.equal(service.disable({encodedDir, sourcePath: 'memory/conventions.md'}), true)
    assert.equal(service.retrieve({workDir: 'D:\\demo', encodedDir, text: '修改代码并使用 UTF-8'}).items.length, 0)
    assert.equal(service.list({encodedDir, status: null})[0].status, 'disabled')
    assert.equal(service.setEnabled({encodedDir, sourcePath: 'memory/conventions.md', enabled: true}), true)
    assert.equal(service.list({encodedDir, query: 'UTF-8'}).length, 1)
    assert.equal(service.retrieve({workDir: 'D:\\demo', encodedDir, text: '修改代码并使用 UTF-8'}).items.length, 1)
    assert.ok(service.list({encodedDir})[0].lastUsedAt)
    unlinkSync(join(home, 'projects', encodedDir, 'memory', 'conventions.md'))
    const refreshed = service.refreshProject({workDir: 'D:\\demo', encodedDir})
    assert.equal(refreshed.removed, 1)
    assert.deepEqual(service.list({encodedDir}), [])
})

test('Memory 索引支持重建和显式删除', t => {
    const {db, service, encodedDir} = fixture()
    t.after(() => db.close())
    service.refreshProject({workDir: 'D:\\demo', encodedDir})
    service.disable({encodedDir, sourcePath: 'memory/conventions.md'})
    assert.equal(service.rebuild({workDir: 'D:\\demo', encodedDir}).indexed, 1)
    assert.equal(service.list({encodedDir})[0].status, 'disabled')
    assert.equal(service.remove({encodedDir, sourcePath: 'memory/conventions.md'}), true)
    assert.deepEqual(service.list({encodedDir}), [])
    assert.equal(service.refreshProject({workDir: 'D:\\demo', encodedDir}).indexed, 1)
})

test('明确不要记忆时不注入', t => {
    const {db, service, encodedDir} = fixture()
    t.after(() => db.close())
    const result = service.retrieve({workDir: 'D:\\demo', encodedDir, text: '修改代码，但不要记住这次使用 UTF-8'})
    assert.equal(result.text, '')
})

test('本轮明确覆盖项目约定时不召回冲突 Memory', t => {
    const {db, service, encodedDir} = fixture()
    t.after(() => db.close())
    const result = service.retrieve({workDir: 'D:\\demo', encodedDir, text: '修改代码，这次不要使用 UTF-8，改用 GBK'})
    assert.equal(result.text, '')
    assert.deepEqual(result.items, [])
})

test('Memory 注入按 UTF-8 字节限制总大小并脱敏常见凭据格式', t => {
    const {home, db, encodedDir} = fixture()
    t.after(() => db.close())
    writeFileSync(join(home, 'projects', encodedDir, 'memory', 'secrets.md'), [
        '# 中文约定',
        '"apiKey": "json-secret-value"',
        'Authorization: Bearer bearer-secret-value',
        'token: plain-token-value',
        'token: sk-1234567890abcdef',
        '-----BEGIN PRIVATE KEY-----',
        'private-secret-value',
        '-----END PRIVATE KEY-----',
        '修改代码时保留中文说明。'.repeat(600),
    ].join('\n'), 'utf8')
    const service = createMemoryService({bridgeHome: home, stateStore: db, maxBytes: 1024})
    const result = service.retrieve({workDir: 'D:\\demo', encodedDir, text: '修改代码并保留中文约定'})
    assert.ok(Buffer.byteLength(result.text, 'utf8') <= 1024)
    assert.doesNotMatch(result.text, /json-secret-value|bearer-secret-value|plain-token-value|1234567890abcdef|private-secret-value/)
})
