import assert from 'node:assert/strict'
import {mkdtemp, readFile, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {createHash} from 'node:crypto'
import {materializeTranscript, recoverTranscript} from './transcript-materializer.mjs'

function digest(body) { return createHash('sha256').update(body).digest('hex') }

test('数据库 transcript 使用临时文件和原子 rename 物化，并返回版本/hash', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bridge-transcript-materialize-'))
    const body = '{"cwd":"D:/demo"}\n'
    const repository = {get: async () => ({body, version: 4})}
    const targetPath = join(home, 'projects', 'p', 's.jsonl')
    const result = await materializeTranscript({repository, projectKey: 'p', sessionId: 's', targetPath, expectedHash: digest(body)})
    assert.equal(result.version, 4)
    assert.equal(await readFile(targetPath, 'utf8'), body)
    assert.equal((await stat(home)).isDirectory(), true)
})

test('hash 不匹配拒绝物化且不覆盖现有文件', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bridge-transcript-materialize-'))
    const targetPath = join(home, 's.jsonl')
    const repository = {get: async () => ({body: 'new\n', version: 2})}
    await assert.rejects(() => materializeTranscript({repository, projectKey: 'p', sessionId: 's', targetPath, expectedHash: 'bad'}), error => error.code === 'TRANSCRIPT_RECOVERY_HASH_MISMATCH')
})

test('已有文件 hash 正确时优先使用文件，缺失时从 PostgreSQL 恢复', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bridge-transcript-recover-'))
    const body = 'history\n'
    const targetPath = join(home, 's.jsonl')
    const repository = {get: async () => ({body, version: 3})}
    const existing = await recoverTranscript({repository, projectKey: 'p', sessionId: 's', targetPath, expectedHash: digest(body)})
    assert.equal(existing.source, 'postgres')
    const reused = await recoverTranscript({repository, projectKey: 'p', sessionId: 's', targetPath, expectedHash: digest(body)})
    assert.equal(reused.source, 'filesystem')
})

test('取消不会留下临时文件', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bridge-transcript-cancel-'))
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(() => materializeTranscript({repository: {get: async () => ({body: 'x'})}, projectKey: 'p', sessionId: 's', targetPath: join(home, 's.jsonl'), signal: controller.signal}), error => error.code === 'TRANSCRIPT_RECOVERY_ABORTED')
})
