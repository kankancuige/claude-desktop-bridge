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
    assert.deepEqual(tables, [
        'bridge_memory_index', 'bridge_schema', 'bridge_session_index', 'bridge_state_entries',
        'bridge_task_events', 'bridge_task_state', 'bridge_workflow_state',
    ])
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
    assert.equal(store.updateSessionSettings('D--demo', 's1', {permissionMode: 'acceptEdits', mirrors: {wechat: true}, lastOpenedAt: 7}), true)
    assert.equal(store.getSessionCatalog('D--demo', 's1').permissionMode, 'acceptEdits')
    assert.deepEqual(store.getSessionCatalog('D--demo', 's1').mirrors, {wechat: true})
    assert.equal(store.updateSessionSettingsByIds('D--demo', ['s1'], {permissionMode: 'plan'}), true)
    assert.equal(store.getSessionCatalog('D--demo', 's1').permissionMode, 'plan')
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

test('会话索引切换 canonical 项目键时按 transcript 路径转移并保留设置', t => {
    const {store} = fixture()
    t.after(() => store.close())
    const transcriptPath = 'D:/state/legacy/s1.jsonl'
    store.upsertSessionCatalog({
        projectKey: 'D----------', sessionId: 's1', transcriptPath, workDir: 'D:/项目/测试',
        source: 'wechat', visibility: 'visible', permissionMode: 'acceptEdits', mirrors: {wechat: true},
    })

    store.upsertSessionCatalog({
        projectKey: 'D--项目-测试', sessionId: 's1', transcriptPath, workDir: 'D:/项目/测试',
        visibility: 'visible',
    })

    assert.equal(store.getSessionCatalog('D----------', 's1'), null)
    const canonical = store.getSessionCatalog('D--项目-测试', 's1')
    assert.equal(canonical.source, 'wechat')
    assert.equal(canonical.permissionMode, 'acceptEdits')
    assert.deepEqual(canonical.mirrors, {wechat: true})
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

test('会话权限和镜像设置关闭数据库后仍可恢复', () => {
    const home = mkdtempSync(join(tmpdir(), 'bridge-state-reopen-'))
    const first = new BridgeStateDb({bridgeHome: home})
    first.upsertSessionCatalog({projectKey: 'D--demo', sessionId: 'sdk-1', transcriptPath: 'D:/state/sdk-1.jsonl', mtime: 1, size: 1})
    first.updateSessionSettings('D--demo', 'sdk-1', {
        permissionMode: 'bypassPermissions',
        mirrors: {wechat: true, feishu: false, dingtalk: true},
        lastOpenedAt: 99,
    })
    first.close()
    const second = new BridgeStateDb({bridgeHome: home})
    const restored = second.getSessionCatalog('D--demo', 'sdk-1')
    assert.equal(restored.permissionMode, 'bypassPermissions')
    assert.equal(restored.lastOpenedAt, 99)
    assert.equal(restored.mirrors.dingtalk, true)
    second.close()
})

test('任务状态投影与事件在同一事务内幂等写入并支持重启恢复', t => {
    const {home, store} = fixture()
    t.after(() => store.close())
    const state = {
        status: 'reviewing', outcome: null, continuationReason: null, resumable: true,
        taskId: 'task-1', sdkSessionId: 'sdk-1', sequence: 2, updatedAt: 20,
        review: {round: 1, tier: 'power'}, notifications: {wechat: {state: 'pending'}},
    }
    store.recordTaskTransition({
        projectKey: 'D--demo', taskKey: 'task-1', sessionId: 'gw-1', taskId: 'task-1',
        sdkSessionId: 'sdk-1', revision: 2, eventType: 'task/state-changed', state,
    })
    // 旧 revision 不能覆盖较新的状态，也不能制造重复事件。
    store.recordTaskTransition({
        projectKey: 'D--demo', taskKey: 'task-1', revision: 1, eventType: 'task/state-changed',
        state: {...state, status: 'running', updatedAt: 10},
    })
    store.recordTaskTransition({
        projectKey: 'D--demo', taskKey: 'task-1', revision: 2, eventType: 'task/state-changed',
        state: {...state, status: 'failed', updatedAt: 20},
    })
    assert.equal(store.appendTaskEvent({
        projectKey: 'D--demo', taskKey: 'task-1', revision: 3, eventType: 'task/future', state,
    }), false)
    const restored = store.getTaskState('D--demo', 'sdk-1')
    assert.equal(restored.status, 'reviewing')
    assert.equal(restored.revision, 2)
    assert.equal(restored.notifications.wechat.state, 'pending')
    assert.equal(Object.hasOwn(restored.state, 'finalReplyText'), false)
    assert.equal(Object.hasOwn(restored.state, 'detail'), false)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM bridge_task_events WHERE project_key = ? AND task_key = ?').get('D--demo', 'task-1').count, 1)
    store.upsertWorkflowState({projectKey: 'D--demo', workflowId: 'wf-1', parentSessionId: 'gw-1', name: 'review', status: 'running', currentPhase: 'Review', revision: 1, state: {status: 'running', runKey: 'review:gw-1', taskOwned: true, returnsToParent: true, logs: [{msg: '正文'}], result: '审查正文'}})
    const workflow = store.listWorkflowStates('D--demo', {parentSessionId: 'gw-1'})[0]
    assert.equal(workflow.currentPhase, 'Review')
    assert.equal(Object.hasOwn(workflow.state, 'logs'), false)
    assert.equal(Object.hasOwn(workflow.state, 'result'), false)
    assert.equal(workflow.state.runKey, 'review:gw-1')
    assert.equal(workflow.state.taskOwned, true)
    store.close()
    const reopened = new (store.constructor)({bridgeHome: home})
    t.after(() => reopened.close())
    assert.equal(reopened.getTaskState('D--demo', 'task-1').status, 'reviewing')
})

test('通知 worker 可按任务标识回写持久化任务投影', t => {
    const {store} = fixture()
    t.after(() => store.close())
    store.recordTaskTransition({
        projectKey: 'D--demo', taskKey: 'task-notify', sessionId: 'gw-notify', taskId: 'task-notify',
        revision: 1, state: {status: 'succeeded', taskId: 'task-notify', updatedAt: 1,
            notifications: {feishu: {state: 'pending', notificationId: 'task-notify:task_completed'}}},
    })
    assert.equal(store.updateTaskNotification({
        taskId: 'task-notify', platform: 'feishu', notificationId: 'task-notify:task_completed', state: 'sent', updatedAt: 2,
    }), true)
    const restored = store.getTaskState('D--demo', 'task-notify')
    assert.equal(restored.notifications.feishu.state, 'sent')
    assert.equal(restored.state.notifications.feishu.state, 'sent')
    assert.equal(restored.revision, 2)
    store.updateTaskNotification({
        taskId: 'task-notify', platform: 'feishu', notificationId: 'task-notify:task_completed', state: 'failed', updatedAt: 3,
    })
    assert.equal(store.listTaskNotificationIntents('feishu')[0].taskId, 'task-notify')
    assert.deepEqual(store.listTaskNotificationIntents('wechat'), [])
})

test('schema v3 数据库可幂等迁移到 v4 任务与 Workflow 表', () => {
    const home = mkdtempSync(join(tmpdir(), 'bridge-state-db-migrate-'))
    const first = new BridgeStateDb({bridgeHome: home})
    first.db.prepare('UPDATE bridge_schema SET version = 3 WHERE id = 1').run()
    first.close()
    const second = new BridgeStateDb({bridgeHome: home})
    assert.equal(second.schemaVersion, 4)
    assert.equal(second.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bridge_task_state'").get()?.name, 'bridge_task_state')
    second.close()
})

test('有界清理只删除过期终态，不删除运行或审查中的任务', t => {
    const home = mkdtempSync(join(tmpdir(), 'bridge-state-db-prune-'))
    const store = new BridgeStateDb({bridgeHome: home, now: () => 1_000_000})
    t.after(() => store.close())
    for (const [taskKey, status, updatedAt] of [
        ['old-done', 'succeeded', 1], ['old-running', 'running', 1], ['fresh-done', 'failed', 999_999],
        ['old-notification-pending', 'succeeded', 2],
    ]) {
        const notifications = taskKey === 'old-notification-pending' ? {wechat: {state: 'pending'}} : {}
        store.upsertTaskState({projectKey: 'D--demo', taskKey, revision: updatedAt, updatedAt, state: {status, updatedAt, notifications}})
    }
    store.upsertWorkflowState({projectKey: 'D--demo', workflowId: 'old-wf', status: 'done', revision: 1, state: {status: 'done'}})
    store.db.prepare('UPDATE bridge_workflow_state SET updated_at = 1 WHERE workflow_id = ?').run('old-wf')
    assert.equal(store.pruneTaskState({projectKey: 'D--demo', olderThanMs: 60_000, maxRows: 10}), 1)
    assert.deepEqual(store.listTaskStates('D--demo').map(item => item.taskKey).sort(), ['fresh-done', 'old-notification-pending', 'old-running'])
    assert.equal(store.pruneWorkflowState({projectKey: 'D--demo', olderThanMs: 60_000, maxRows: 10}), 1)
})
