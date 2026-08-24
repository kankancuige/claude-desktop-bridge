import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectSessionRuntime} from './project-session-runtime.mjs'

test('项目扫描按 transcript cwd 分组并通过 catalog 返回可见 Session', async () => {
    const runtime = createProjectSessionRuntime({
        bridgeHome: 'D:/bridge', projectsCacheTtl: 0, scheduledTasks: {},
        readdirSync: path => path.replaceAll('\\', '/').toLowerCase() === 'd:/bridge/projects' ? [{name: 'D--demo', isDirectory: () => true}] : ['s1.jsonl'],
        existsSync: path => path.endsWith('s1.jsonl') || path.endsWith('D--demo'),
        readFileHeadLines: () => ['{"cwd":"D:/demo"}'],
        statSync: path => ({isDirectory: () => !path.endsWith('s1.jsonl'), isFile: () => path.endsWith('s1.jsonl'), mtimeMs: 2, size: 10}),
        readJSON: () => ({}), writeJSON: () => {},
        classifyTranscriptFile: () => 'main', decodeProjectName: value => value === 'D--demo' ? 'D:/demo' : value,
        encodeProjectName: value => value === 'd:/demo' ? 'D--demo' : value,
        normalizeWorkDir: value => String(value).toLowerCase(),
        reconcileSessionCatalog: () => [{id: 's1', title: '任务', size: 10, mtime: 2}],
        loadSessionVisibility: () => ({sessions: {}, legacyMigrationVersion: 2}),
        shouldShowSession: () => true,
        sessionMirrorStorePath: () => 'D:/bridge/projects/D--demo/bridge-session-visibility.json',
        getPersistedMirrors: () => null,
        saveSessionVisibility: () => true,
        logger: {debug: (...args) => console.log('debug', ...args), warn: (...args) => console.log('warn', ...args)},
    })
    const projects = await runtime.scanProjects()
    assert.equal(projects.length, 1)
    assert.equal(projects[0].sessions[0].id, 's1')
})

test('删除标记在项目列表中立即过滤并可失效缓存', async () => {
    let calls = 0
    const runtime = createProjectSessionRuntime({
        bridgeHome: 'D:/bridge', projectsCacheTtl: 60_000,
        readdirSync: path => path === 'D:/bridge/projects' ? [] : [], existsSync: () => false,
        readFileHeadLines: () => [], statSync: () => ({}), readJSON: () => ({}), writeJSON: () => {},
        classifyTranscriptFile: () => 'main', decodeProjectName: value => value, encodeProjectName: value => value,
        normalizeWorkDir: value => value, reconcileSessionCatalog: () => { calls++; return [] },
        loadSessionVisibility: () => ({sessions: {}, legacyMigrationVersion: 2}), shouldShowSession: () => true,
        sessionMirrorStorePath: () => 'D:/bridge/projects/x/bridge-session-visibility.json', saveSessionVisibility: () => true,
    })
    runtime.markSessionDeleted('s1')
    assert.equal(runtime.filterDeletedSessions([{sessionCount: 1, sessions: [{id: 's1'}]}]).length, 0)
    await runtime.scanProjects()
    assert.equal(calls, 0)
})
