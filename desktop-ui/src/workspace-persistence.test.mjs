import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./workspace-persistence.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {parseWorkspaceShell, serializeWorkspaceShell} = await import(moduleUrl)

test('invalid persisted JSON falls back to an empty shell', () => {
  assert.deepEqual(parseWorkspaceShell('{broken'), {
    version: 1,
    projects: [],
    tabs: [],
    activeTabId: null,
    activeProject: null,
  })
})

test('workspace shell keeps only serializable project and session descriptors', () => {
  const raw = serializeWorkspaceShell({
    projects: ['D:/work', 'D:/work'],
    tabs: [{
      id: 'tab-1',
      projectPath: 'D:/work',
      label: 'work',
      sessionId: 'gateway-1',
      historySessionId: 'sdk-1',
    }],
    activeTabId: 'tab-1',
    activeProject: 'D:/work',
  })
  const parsed = parseWorkspaceShell(raw)

  assert.deepEqual(parsed.projects, ['D:/work'])
  assert.equal(parsed.tabs[0].sessionId, 'gateway-1')
  assert.equal(parsed.tabs[0].historySessionId, 'sdk-1')
  assert.equal(parsed.activeTabId, 'tab-1')
})

test('unknown active tab is not restored', () => {
  const parsed = parseWorkspaceShell(JSON.stringify({
    projects: [], tabs: [], activeTabId: 'missing', activeProject: null,
  }))
  assert.equal(parsed.activeTabId, null)
})
