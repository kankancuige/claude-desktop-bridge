import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {migrateContentFiles} from './content-migration.mjs'

test('Memory Markdown 与 JSONL transcript 通过 StorageGateway.content 迁移', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bridge-content-migration-'))
    const project = join(root, 'projects', 'D--demo')
    mkdirSync(join(project, 'memory'), {recursive: true})
    writeFileSync(join(project, 'memory', 'rules.md'), '# 规则\n', 'utf8')
    writeFileSync(join(project, 'session-1.jsonl'), '{"type":"user"}\n', 'utf8')
    const writes = []
    const result = await migrateContentFiles({bridgeHome: root, gateway: {content: {put: async value => writes.push(value)}}})
    assert.deepEqual(result, {projects: 1, memories: 1, transcripts: 1, bytes: 25, skipped: 0, failed: 0, dryRun: false})
    assert.deepEqual(writes.map(item => item.kind), ['memory', 'transcript'])
    assert.equal(writes[0].sourceKey, 'memory/rules.md')
    assert.equal(writes[1].sourceKey, 'session/session-1')
})

test('dry-run 不写入 PostgreSQL', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bridge-content-dry-run-'))
    const project = join(root, 'projects', 'D--demo')
    mkdirSync(join(project, 'memory'), {recursive: true})
    writeFileSync(join(project, 'memory', 'rules.md'), '# 规则\n', 'utf8')
    let called = false
    const result = await migrateContentFiles({bridgeHome: root, gateway: {content: {put: async () => { called = true }}}, includeTranscripts: false, dryRun: true})
    assert.equal(result.memories, 1)
    assert.equal(called, false)
})
