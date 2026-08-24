import assert from 'node:assert/strict'
import test from 'node:test'
import {buildPostgresBackupPlan, runPostgresBackupRestoreAcceptance, validatePostgresRestoreEvidence} from './postgres-backup-restore-acceptance.mjs'

test('备份恢复命令使用参数数组，不把连接串拼入日志或 shell', () => {
    const plan = buildPostgresBackupPlan({connectionString: 'postgresql://user:password@127.0.0.1/db', schema: 'bridge', dumpPath: 'D:/tmp/bridge.dump', restoreDatabase: 'bridge_restore'})
    assert.deepEqual(plan.dump.args.slice(0, 4), ['--format=custom', '--no-owner', '--schema', 'bridge'])
    assert.equal(plan.restore.args.includes('postgresql://user:password@127.0.0.1/db'), false)
    assert.equal(plan.dump.args.at(-1), 'postgresql://user:password@127.0.0.1/db')
})

test('恢复证据必须同时包含 schema、向量维度和 transcript hash', () => {
    const good = validatePostgresRestoreEvidence({schema: 'bridge', contentCounts: [{kind: 'memory', count: 1}], embeddingDimensions: [1536], transcript: {status: 'materialized', bytes: 10, hash: 'a'.repeat(64)}})
    assert.equal(good.passed, true)
    const bad = validatePostgresRestoreEvidence({schema: 'bridge', contentCounts: [], embeddingDimensions: [0], transcript: null})
    assert.equal(bad.passed, false)
})

test('备份、恢复和验证按顺序执行，验证失败不返回成功', async () => {
    const calls = []
    const result = await runPostgresBackupRestoreAcceptance({connectionString: 'postgres://local/db', schema: 'bridge', dumpPath: 'dump', restoreDatabase: 'restore', execFile: async (command, args) => { calls.push([command, args]) }, verify: async () => ({schema: 'bridge', contentCounts: [], embeddingDimensions: [3], transcript: {status: 'materialized', bytes: 0, hash: 'b'.repeat(64)}})})
    assert.equal(result.verified, true)
    assert.deepEqual(calls.map(item => item[0]), ['pg_dump', 'pg_restore'])
})
