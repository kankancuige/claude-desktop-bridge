import assert from 'node:assert/strict'
import {existsSync, mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {BridgeStateDb, bridgeStateDbPath} from './bridge-state-db.mjs'

function fixture() {
    const home = mkdtempSync(join(tmpdir(), 'bridge-state-db-'))
    const store = new BridgeStateDb({bridgeHome: home})
    return {home, store}
}

test('创建 SQLite schema、WAL 和可重建状态表', t => {
    const {home, store} = fixture()
    t.after(() => store.close())
    assert.equal(store.available, true)
    assert.equal(store.mode, 'sqlite')
    assert.equal(existsSync(bridgeStateDbPath(home)), true)
    const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name)
    assert.deepEqual(tables, ['bridge_memory_index', 'bridge_schema', 'bridge_session_index', 'bridge_state_entries'])
    const journal = store.db.prepare('PRAGMA journal_mode').get()
    assert.equal(String(Object.values(journal)[0]).toLowerCase(), 'wal')
})

test('状态条目按 kind/platform/id 原子替换并保持加密载荷字符串', t => {
    const {store} = fixture()
    t.after(() => store.close())
    store.replaceEntries('inbox', 'wechat', [
        ['wechat:1', {state: 'processing', at: 100, attempts: 1, payload: 'encrypted-value'}],
        ['wechat:2', {state: 'completed', at: 200, attempts: 2}],
    ])
    const entries = store.loadEntries('inbox', 'wechat')
    assert.equal(entries.get('wechat:1').payload, 'encrypted-value')
    assert.equal(entries.get('wechat:2').state, 'completed')
    store.replaceEntries('inbox', 'wechat', [['wechat:3', {state: 'failed', updatedAt: 300}]])
    assert.deepEqual([...store.loadEntries('inbox', 'wechat').keys()], ['wechat:3'])
    assert.equal(store.clearEntries('inbox', 'wechat'), 1)
    assert.deepEqual([...store.loadEntries('inbox', 'wechat').keys()], [])
})

test('通知状态可以在适配器停止后直接从 SQLite 汇总', t => {
    const {store} = fixture()
    t.after(() => store.close())
    store.replaceEntries('outbox', 'feishu', [
        ['feishu:1', {state: 'pending'}],
        ['feishu:2', {state: 'failed'}],
        ['feishu:3', {state: 'dead'}],
    ])
    assert.deepEqual(store.summarizeEntries('outbox', 'feishu'), {pending: 1, failed: 1, dead: 1, sent: 0})
})

test('会话和 Memory 索引可幂等更新、限定项目范围', t => {
    const {store} = fixture()
    t.after(() => store.close())
    store.upsertSessionIndex({projectKey: 'D--demo', sessionId: 's1', transcriptPath: 'D:/state/s1.jsonl', mtime: 2, size: 20, title: '任务'})
    store.upsertSessionIndex({projectKey: 'D--demo', sessionId: 's1', transcriptPath: 'D:/state/s1.jsonl', mtime: 3, size: 30, title: '更新'})
    assert.equal(store.listSessionIndex('D--demo')[0].size, 30)
    assert.deepEqual(store.listSessionIndex('D--other'), [])
    store.upsertMemoryIndex({projectKey: 'D--demo', sourcePath: 'memory/a.md', title: '约定', keywords: 'utf8,中文', contentHash: 'abc', mtime: 4, size: 42, lastVerifiedAt: 5, confidence: 0.9})
    assert.equal(store.listMemoryIndex('D--demo')[0].title, '约定')
    assert.equal(store.listMemoryIndex('D--demo')[0].scope, 'project')
    assert.equal(store.listMemoryIndex('D--demo')[0].confidence, 0.9)
    assert.equal(store.markMemoryUsed('D--demo', 'memory/a.md', 9), true)
    assert.equal(store.listMemoryIndex('D--demo')[0].lastUsedAt, 9)
    store.removeMemoryIndex('D--demo', 'memory/a.md')
    assert.deepEqual(store.listMemoryIndex('D--demo'), [])
})

test('损坏 SQLite 会被隔离并明确降级，原文件不会被覆盖', () => {
    const home = mkdtempSync(join(tmpdir(), 'bridge-state-corrupt-'))
    const dbPath = bridgeStateDbPath(home)
    writeFileSync(dbPath, 'not-a-sqlite-database', 'utf8')
    const store = new BridgeStateDb({bridgeHome: home, now: () => 12345})
    assert.equal(store.available, false)
    assert.equal(store.degraded, true)
    assert.equal(store.degradedReason, 'database_corrupt')
    assert.equal(existsSync(dbPath), false)
    assert.equal(existsSync(`${dbPath}.corrupt-12345`), true)
    store.close()
})

test('不可用 SQLite 时给出明确降级状态而不是假装已启用', () => {
    const store = new BridgeStateDb({dbPath: join(mkdtempSync(join(tmpdir(), 'bridge-state-db-')), 'state.db'), required: false})
    // 正常环境应启用 SQLite；该断言只保证状态字段始终存在，方便 native driver 缺失时的降级监控。
    assert.ok(['sqlite', 'unavailable'].includes(store.mode))
    assert.equal(typeof store.degraded, 'boolean')
    store.close()
})
