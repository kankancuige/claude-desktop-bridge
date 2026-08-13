import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./session-tab.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {findSessionTab, sessionTabIdentityKey, tabMatchesSession, tabCanHostNewSession} = await import(moduleUrl)

test('同一项目的不同历史会话不能复用同一个 tab', () => {
  const tab = {projectPath: 'D:/work', historySessionId: 'sdk-a', gatewaySessionId: 'gw-a'}
  assert.equal(tabMatchesSession(tab, 'd:/WORK', 'sdk-a'), true)
  assert.equal(tabMatchesSession(tab, 'D:/work', 'sdk-b'), false)
})

test('只有空壳 tab 才能承载新会话', () => {
  assert.equal(tabCanHostNewSession({projectPath: 'D:/work', historySessionId: null, gatewaySessionId: null}, 'D:/work'), true)
  assert.equal(tabCanHostNewSession({projectPath: 'D:/work', historySessionId: null, gatewaySessionId: 'gw-a'}, 'D:/work'), false)
})

test('同一项目按历史会话 ID 选择各自的 tab', () => {
  const tabs = [
    {projectPath: 'D:/work', historySessionId: 'sdk-a', gatewaySessionId: 'gw-a'},
    {projectPath: 'D:/work', historySessionId: 'sdk-b', gatewaySessionId: 'gw-b'},
  ]
  assert.equal(findSessionTab(tabs, 'D:/work', 'sdk-b'), tabs[1])
  assert.equal(findSessionTab(tabs, 'D:/work', 'sdk-c'), undefined)
})

test('持久化 tab 使用规范化项目路径和会话 ID 去重', () => {
  assert.equal(
    sessionTabIdentityKey({projectPath: 'D:\\Work\\', historySessionId: 'sdk-a', gatewaySessionId: 'gw-a'}),
    'd:/work|sdk-a',
  )
  assert.equal(sessionTabIdentityKey({projectPath: 'D:/work', historySessionId: null, gatewaySessionId: null}), null)
})
