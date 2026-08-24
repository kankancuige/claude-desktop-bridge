import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, readFileSync, unlinkSync, utimesSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {createPostgresStateFixture} from '../test-support/postgres-state-fixture.mjs'
import {reconcileSessionCatalog as reconcileSessionCatalogImpl} from './session-catalog.mjs'
import {createSessionRepository} from '../storage/repositories/session-repository.mjs'

function reconcileSessionCatalog(options) {
    return reconcileSessionCatalogImpl({...options, repository: options.repository || createSessionRepository({stateStore: options.stateStore})})
}

const gatewaySource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime', 'project-session-runtime.mjs'), 'utf8')

function fixture() {
    const home = mkdtempSync(join(tmpdir(), 'bridge-session-catalog-'))
    const projectDir = join(home, 'project')
    const {store: stateStore} = createPostgresStateFixture()
    return {home, projectDir, stateStore, repository: createSessionRepository({stateStore})}
}

test('协调器只索引可见用户会话并保留 transcript 路径', t => {
    const {projectDir, stateStore} = fixture()
    t.after(() => stateStore.close())
    const user = join(projectDir, 'sdk-user.jsonl')
    const agent = join(projectDir, 'sdk-agent.jsonl')
    mkdirSync(projectDir, {recursive: true})
    writeFileSync(user, JSON.stringify({type: 'user', cwd: 'D:/demo', message: {content: '修复按钮'}}) + '\n', 'utf8')
    writeFileSync(agent, JSON.stringify({type: 'user', isSidechain: true, message: {content: '内部审查'}}) + '\n', 'utf8')
    const rows = reconcileSessionCatalog({
        projectKey: 'D--demo', projectDir, workDir: 'D:/demo',
        visibility: {sessions: {'sdk-user': {source: 'desktop'}}},
        stateStore, readHeadLines: path => readFileSync(path, 'utf8').split('\n'),
    })
    assert.deepEqual(rows.map(row => row.id), ['sdk-user'])
    assert.equal(stateStore.listSessionIndex('D--demo')[0].title, '修复按钮')
    assert.equal(stateStore.listSessionIndex('D--demo')[0].transcriptPath, user)
})

test('mtime 和 size 未变化时复用索引标题，不重新读取 transcript', t => {
    const {projectDir, stateStore} = fixture()
    t.after(() => stateStore.close())
    mkdirSync(projectDir, {recursive: true})
    const path = join(projectDir, 'sdk-user.jsonl')
    writeFileSync(path, JSON.stringify({type: 'user', message: {content: '原始标题'}}) + '\n', 'utf8')
    const input = {projectKey: 'D--demo', projectDir, workDir: 'D:/demo', visibility: {sessions: {'sdk-user': {source: 'desktop'}}}, stateStore}
    reconcileSessionCatalog({...input, readHeadLines: p => readFileSync(p, 'utf8').split('\n')})
    let reads = 0
    reconcileSessionCatalog({...input, readHeadLines: () => { reads++ ; return [] }})
    assert.equal(reads, 0)
})

test('首次协调导入权限和 IM 镜像设置，且不复制 transcript 正文', t => {
    const {projectDir, stateStore} = fixture()
    t.after(() => stateStore.close())
    mkdirSync(projectDir, {recursive: true})
    const path = join(projectDir, 'sdk-user.jsonl')
    writeFileSync(path, JSON.stringify({type: 'user', message: {content: '敏感正文不进入索引'}}) + '\n', 'utf8')
    reconcileSessionCatalog({
        projectKey: 'D--demo', projectDir, workDir: 'D:/demo',
        visibility: {sessions: {'sdk-user': {source: 'wechat'}}}, stateStore,
        readHeadLines: p => readFileSync(p, 'utf8').split('\n'),
        settingsForSession: () => ({permissionMode: 'acceptEdits', mirrors: {wechat: true, feishu: false, dingtalk: false}}),
    })
    const row = stateStore.getSessionCatalog('D--demo', 'sdk-user')
    assert.equal(row.permissionMode, 'acceptEdits')
    assert.equal(row.mirrors.wechat, true)
    assert.equal(Object.hasOwn(stateStore.getSessionCatalog('D--demo', 'sdk-user'), 'content'), false)
})

test('删除 transcript 只清理派生索引，不删除其他源文件', t => {
    const {projectDir, stateStore} = fixture()
    t.after(() => stateStore.close())
    mkdirSync(projectDir, {recursive: true})
    const path = join(projectDir, 'sdk-user.jsonl')
    writeFileSync(path, JSON.stringify({type: 'user', message: {content: '待删除'}}) + '\n', 'utf8')
    const input = {
        projectKey: 'D--demo', projectDir, workDir: 'D:/demo',
        visibility: {sessions: {'sdk-user': {source: 'desktop'}}}, stateStore,
        readHeadLines: p => readFileSync(p, 'utf8').split('\n'),
    }
    reconcileSessionCatalog(input)
    unlinkSync(path)
    reconcileSessionCatalog(input)
    assert.deepEqual(stateStore.listSessionIndex('D--demo'), [])
})

test('visibility sidecar 丢失时从 PostgreSQL 索引恢复已确认可见的会话', t => {
    const {projectDir, stateStore} = fixture()
    t.after(() => stateStore.close())
    mkdirSync(projectDir, {recursive: true})
    const path = join(projectDir, 'sdk-user.jsonl')
    writeFileSync(path, JSON.stringify({type: 'user', message: {content: '恢复会话'}}) + '\n', 'utf8')
    stateStore.upsertSessionCatalog({
        projectKey: 'D--demo', sessionId: 'sdk-user', transcriptPath: path,
        workDir: 'D:/demo', source: 'desktop', visibility: 'visible', mtime: 1, size: 1, title: '旧标题',
    })
    const rows = reconcileSessionCatalog({
        projectKey: 'D--demo', projectDir, workDir: 'D:/demo', visibility: {sessions: {}},
        stateStore, readHeadLines: p => readFileSync(p, 'utf8').split('\n'),
    })
    assert.deepEqual(rows.map(row => row.id), ['sdk-user'])
})

test('限制会话数量前先按 mtime 选择最新 transcript', t => {
    const {projectDir, stateStore} = fixture()
    t.after(() => stateStore.close())
    mkdirSync(projectDir, {recursive: true})
    for (const [id, stamp] of [['old', 100], ['new', 300], ['middle', 200]]) {
        const path = join(projectDir, `${id}.jsonl`)
        writeFileSync(path, JSON.stringify({type: 'user', message: {content: id}}) + '\n', 'utf8')
        utimesSync(path, stamp / 1000, stamp / 1000)
    }
    const visibility = {sessions: Object.fromEntries(['old', 'new', 'middle'].map(id => [id, {source: 'desktop'}]))}
    const rows = reconcileSessionCatalog({
        projectKey: 'D--demo', projectDir, workDir: 'D:/demo', visibility,
        stateStore, maxSessions: 2, readHeadLines: p => readFileSync(p, 'utf8').split('\n'),
    })
    assert.deepEqual(rows.map(row => row.id), ['new', 'middle'])
})

test('旧 visibility 空迁移后可从主 transcript 修复目录并继续过滤 Agent', t => {
    const {projectDir, stateStore} = fixture()
    t.after(() => stateStore.close())
    mkdirSync(projectDir, {recursive: true})
    const main = join(projectDir, 'sdk-main.jsonl')
    const agent = join(projectDir, 'sdk-agent.jsonl')
    writeFileSync(main, JSON.stringify({type: 'user', sessionId: 'sdk-main', cwd: 'D:/demo', isSidechain: false, parentUuid: null, message: {content: '继续之前的任务'}}) + '\n', 'utf8')
    writeFileSync(agent, JSON.stringify({type: 'user', sessionId: 'sdk-agent', cwd: 'D:/demo', isSidechain: true, parentUuid: 'sdk-main', message: {content: '内部审查'}}) + '\n', 'utf8')

    const input = {
        projectKey: 'D--demo', projectDir, workDir: 'D:/demo',
        visibility: {version: 1, legacyMigrationVersion: 1, sessions: {}},
        repairLegacyMainTranscripts: true,
        stateStore, readHeadLines: path => readFileSync(path, 'utf8').split('\n'),
    }
    const first = reconcileSessionCatalog(input)
    const second = reconcileSessionCatalog(input)

    assert.deepEqual(first.map(row => row.id), ['sdk-main'])
    assert.deepEqual(second.map(row => row.id), ['sdk-main'])
    assert.equal(stateStore.getSessionCatalog('D--demo', 'sdk-main').transcriptPath, main)
    assert.equal(stateStore.getSessionCatalog('D--demo', 'sdk-agent'), null)
})

test('同一 cwd 的 canonical 与旧编码目录合并到一个 PostgreSQL 项目键', t => {
    const {home, stateStore} = fixture()
    t.after(() => stateStore.close())
    const canonicalDir = join(home, 'D--项目-测试')
    const legacyDir = join(home, 'D----------')
    mkdirSync(canonicalDir, {recursive: true})
    mkdirSync(legacyDir, {recursive: true})
    const canonicalMain = join(canonicalDir, 'sdk-new.jsonl')
    const legacyMain = join(legacyDir, 'sdk-old.jsonl')
    writeFileSync(canonicalMain, JSON.stringify({type: 'user', sessionId: 'sdk-new', cwd: 'D:/项目/测试', isSidechain: false, message: {content: '新会话'}}) + '\n', 'utf8')
    writeFileSync(legacyMain, JSON.stringify({type: 'user', sessionId: 'sdk-old', cwd: 'D:/项目/测试', isSidechain: false, message: {content: '旧会话'}}) + '\n', 'utf8')

    const rows = reconcileSessionCatalog({
        projectKey: 'D--项目-测试', projectDirs: [canonicalDir, legacyDir], workDir: 'D:/项目/测试',
        visibility: {version: 1, legacyMigrationVersion: 1, sessions: {}},
        repairLegacyMainTranscripts: true,
        stateStore, readHeadLines: path => readFileSync(path, 'utf8').split('\n'),
    })

    assert.deepEqual(new Set(rows.map(row => row.id)), new Set(['sdk-new', 'sdk-old']))
    assert.equal(stateStore.listSessionIndex('D--项目-测试').length, 2)
    assert.equal(stateStore.listSessionIndex('D----------').length, 0)
    assert.equal(rows.find(row => row.id === 'sdk-old').transcriptPath, legacyMain)
})

test('Gateway 项目扫描向协调器传入真实存在的 transcript 首部读取函数', () => {
    assert.match(gatewaySource, /readHeadLines\s*=\s*readFileHeadLines/)
    assert.match(gatewaySource, /reconcileSessionCatalog\(\{[\s\S]*?readHeadLines,/)
})
