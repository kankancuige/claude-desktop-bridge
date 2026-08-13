import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./project-sessions.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {applySessionVisibilityEvent, upsertProjectSession} = await import(moduleUrl)

test('SDK 会话 ID 到达后立即加入对应项目', () => {
  const projects = [{workDir: 'D:/work', encodedDir: 'D--work', sessionCount: 0, lastActive: 0, sessions: []}]
  const result = upsertProjectSession(projects, {workDir: 'D:\\work', encodedDir: 'D--work', sessionId: 'sdk-1', now: 100})
  assert.equal(result[0].sessions[0].id, 'sdk-1')
  assert.equal(result[0].sessions[0].encodedDir, 'D--work')
  assert.equal(result[0].sessionCount, 1)
  assert.equal(result[0].lastActive, 100)
})

test('重复 system_init 不会重复插入同一会话', () => {
  const projects = [{workDir: 'D:/work', encodedDir: 'D--work', sessionCount: 1, lastActive: 50, sessions: [{id: 'sdk-1', title: '已有标题', size: 10}]}]
  const result = upsertProjectSession(projects, {workDir: 'D:/work', encodedDir: 'D--work', sessionId: 'sdk-1', now: 100})
  assert.equal(result[0].sessions.length, 1)
  assert.equal(result[0].sessions[0].title, '已有标题')
})

test('system_init 不会把仅初始化的空会话加入项目列表', () => {
  const projects = [{workDir: 'D:/work', encodedDir: 'D--work', sessionCount: 0, lastActive: 0, sessions: []}]
  const result = applySessionVisibilityEvent(projects, {
    type: 'system_init', historySessionId: 'sdk-empty', source: 'desktop',
  }, {workDir: 'D:/work', encodedDir: 'D--work', now: 100})
  assert.strictEqual(result, projects)
  assert.equal(result[0].sessions.length, 0)
})

test('桌面输入和三种 IM 注入事件会加入项目列表并按 SDK ID 去重', () => {
  let projects = [{workDir: 'D:/work', encodedDir: 'D--work', sessionCount: 0, lastActive: 0, sessions: []}]
  for (const [index, source] of ['desktop', 'wechat', 'feishu', 'dingtalk'].entries()) {
    const event = {type: 'session_visible', historySessionId: `sdk-${source}`, source}
    projects = applySessionVisibilityEvent(projects, event, {workDir: 'D:/work', encodedDir: 'D--work', now: 100 + index})
    projects = applySessionVisibilityEvent(projects, event, {workDir: 'D:/work', encodedDir: 'D--work', now: 200 + index})
  }
  assert.deepEqual(projects[0].sessions.map(session => session.id), [
    'sdk-dingtalk', 'sdk-feishu', 'sdk-wechat', 'sdk-desktop',
  ])
  assert.equal(projects[0].sessionCount, 4)
})

test('Agent、Workflow 和定时任务来源不能加入项目列表', () => {
  const projects = [{workDir: 'D:/work', encodedDir: 'D--work', sessionCount: 0, lastActive: 0, sessions: []}]
  for (const source of ['agent', 'workflow', 'scheduler']) {
    const result = applySessionVisibilityEvent(projects, {
      type: 'session_visible', historySessionId: `sdk-${source}`, source,
    }, {workDir: 'D:/work', encodedDir: 'D--work', now: 100})
    assert.strictEqual(result, projects)
  }
})
