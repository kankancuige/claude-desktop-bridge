import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, unlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
    decodeProjectDirectorySegment,
    findSessionTranscript,
    listProjectTranscriptCandidates,
} from './project-transcript-location.mjs'
import {BridgeStateDb} from '../storage/bridge-state-db.mjs'

function createClaudeHome() {
    const bridgeHome = mkdtempSync(join(tmpdir(), 'bridge-transcript-'))
    mkdirSync(join(bridgeHome, 'projects'), {recursive: true})
    return bridgeHome
}

test('项目目录段只解码一次并保留 Unicode 名称', () => {
    assert.equal(
        decodeProjectDirectorySegment('D--hcd-%E6%89%B3%E6%89%8B-%E5%8D%8F%E8%88%AA-app'),
        'D--hcd-扳手-协航-app',
    )
})

test('项目目录段拒绝目录穿越和路径分隔符', () => {
    assert.equal(decodeProjectDirectorySegment('..'), null)
    assert.equal(decodeProjectDirectorySegment('%2e%2e'), null)
    assert.equal(decodeProjectDirectorySegment('a%2fb'), null)
    assert.equal(decodeProjectDirectorySegment('a%5cb'), null)
})

test('优先读取请求指定目录中的 transcript', () => {
    const bridgeHome = createClaudeHome()
    const encodedDir = 'D--work-project'
    const sessionId = '11111111-1111-4111-8111-111111111111'
    const projectDir = join(bridgeHome, 'projects', encodedDir)
    mkdirSync(projectDir)
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), '{}\n')

    assert.deepEqual(findSessionTranscript({bridgeHome, encodedDir, sessionId}), {
        status: 'found',
        encodedDir,
        filePath: join(projectDir, `${sessionId}.jsonl`),
        fallback: false,
    })
})

test('指定目录中的 transcript cwd 不匹配时拒绝跨项目恢复', () => {
    const bridgeHome = createClaudeHome()
    const encodedDir = 'D--work-project'
    const sessionId = '66666666-6666-4666-8666-666666666666'
    const projectDir = join(bridgeHome, 'projects', encodedDir)
    mkdirSync(projectDir)
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), JSON.stringify({type: 'user', cwd: 'D:\\other'}))

    assert.deepEqual(findSessionTranscript({
        bridgeHome,
        encodedDir,
        sessionId,
        workDir: 'D:/work/project',
    }), {status: 'missing'})
})

test('指定目录不存在时按全局唯一 session ID 兼容查找旧目录', () => {
    const bridgeHome = createClaudeHome()
    const actualDir = 'D--hcd-------WindowsFormsApp1'
    const sessionId = '22222222-2222-4222-8222-222222222222'
    const projectDir = join(bridgeHome, 'projects', actualDir)
    mkdirSync(projectDir)
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), '{}\n')

    assert.deepEqual(findSessionTranscript({
        bridgeHome,
        encodedDir: 'D--hcd-扳手-协航-WindowsFormsApp1',
        sessionId,
    }), {
        status: 'found',
        encodedDir: actualDir,
        filePath: join(projectDir, `${sessionId}.jsonl`),
        fallback: true,
    })
})

test('非法 session ID 和不存在 transcript 返回明确状态', () => {
    const bridgeHome = createClaudeHome()
    assert.deepEqual(findSessionTranscript({bridgeHome, encodedDir: 'D--work', sessionId: '../secret'}), {
        status: 'invalid',
    })
    assert.deepEqual(findSessionTranscript({
        bridgeHome,
        encodedDir: 'D--work',
        sessionId: '33333333-3333-4333-8333-333333333333',
    }), {status: 'missing'})
})

test('同一 session ID 出现在多个目录时拒绝猜测', () => {
    const bridgeHome = createClaudeHome()
    const sessionId = '44444444-4444-4444-8444-444444444444'
    for (const encodedDir of ['D--old-a', 'D--old-b']) {
        const projectDir = join(bridgeHome, 'projects', encodedDir)
        mkdirSync(projectDir)
        writeFileSync(join(projectDir, `${sessionId}.jsonl`), '{}\n')
    }
    assert.deepEqual(findSessionTranscript({bridgeHome, encodedDir: 'D--missing', sessionId}), {
        status: 'ambiguous',
        matches: ['D--old-a', 'D--old-b'],
    })
})

test('显式 workDir 可定位旧版 Unicode 丢失的编码目录', () => {
    const bridgeHome = createClaudeHome()
    const actualDir = 'D--hcd-------WindowsFormsApp1'
    const sessionId = '55555555-5555-4555-8555-555555555555'
    const projectDir = join(bridgeHome, 'projects', actualDir)
    mkdirSync(projectDir)
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), [
        JSON.stringify({type: 'queue-operation'}),
        JSON.stringify({type: 'user', cwd: 'D:\\hcd\\扳手\\协航\\WindowsFormsApp1'}),
    ].join('\n'))

    assert.deepEqual(findSessionTranscript({
        bridgeHome,
        encodedDir: 'D--hcd-扳手-协航-WindowsFormsApp1',
        sessionId,
        workDir: 'D:/hcd/扳手/协航/WindowsFormsApp1',
    }), {
        status: 'found',
        encodedDir: actualDir,
        filePath: join(projectDir, `${sessionId}.jsonl`),
        fallback: true,
    })
})

test('项目候选按真实 cwd 跨旧编码目录聚合并按时间倒序', () => {
    const bridgeHome = createClaudeHome()
    const workDir = 'D:/hcd/扳手/协航/WindowsFormsApp1'
    const files = [
        {dir: 'D--hcd-------WindowsFormsApp1', id: '77777777-7777-4777-8777-777777777777', cwd: 'D:\\hcd\\扳手\\协航\\WindowsFormsApp1'},
        {dir: 'D--other', id: '88888888-8888-4888-8888-888888888888', cwd: 'D:\\other'},
    ]
    for (const item of files) {
        const projectDir = join(bridgeHome, 'projects', item.dir)
        mkdirSync(projectDir)
        writeFileSync(join(projectDir, `${item.id}.jsonl`), JSON.stringify({type: 'user', cwd: item.cwd, message: {content: '任务'}}))
    }
    const result = listProjectTranscriptCandidates({
        bridgeHome,
        encodedDir: 'D--hcd-扳手-协航-WindowsFormsApp1',
        workDir,
    })
    assert.deepEqual(result.map(item => item.id), ['77777777-7777-4777-8777-777777777777'])
    assert.match(result[0].content, /任务/)
})

test('会话索引命中快速路径，文件删除后清理陈旧索引并回退扫描', t => {
    const bridgeHome = createClaudeHome()
    const encodedDir = 'D--work-project'
    const workDir = 'D:/work/project'
    const projectDir = join(bridgeHome, 'projects', encodedDir)
    const sessionId = '99999999-9999-4999-8999-999999999999'
    mkdirSync(projectDir)
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), JSON.stringify({
        type: 'user', cwd: 'D:\\work\\project', message: {content: 'first'},
    }))
    const store = new BridgeStateDb({bridgeHome})
    t.after(() => store.close())

    assert.deepEqual(
        listProjectTranscriptCandidates({bridgeHome, encodedDir, workDir, stateStore: store}).map(item => item.id),
        [sessionId],
    )
    assert.equal(store.listSessionIndex(encodedDir).length, 1)
    assert.deepEqual(
        listProjectTranscriptCandidates({bridgeHome, encodedDir, workDir, stateStore: store}).map(item => item.id),
        [sessionId],
    )

    unlinkSync(join(projectDir, `${sessionId}.jsonl`))
    assert.deepEqual(listProjectTranscriptCandidates({bridgeHome, encodedDir, workDir, stateStore: store}), [])
    assert.deepEqual(store.listSessionIndex(encodedDir), [])
})
