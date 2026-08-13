import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./session-drafts.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {
  parseSessionDraftStore,
  upsertSessionDraft,
  getSessionDraft,
  removeSessionDraft,
  sessionDraftKey,
} = await import(moduleUrl)

test('损坏或过期的草稿不会影响其他会话', () => {
  assert.deepEqual(parseSessionDraftStore('{broken', 1_000), {version: 1, drafts: {}})
  const parsed = parseSessionDraftStore(JSON.stringify({
    version: 1,
    drafts: {
      old: {text: 'old', updatedAt: 1, interrupted: true},
      fresh: {text: 'fresh', updatedAt: 900, interrupted: false},
      invalid: {text: 123, updatedAt: 900},
    },
  }), 1_000, {retentionMs: 500})
  assert.deepEqual(Object.keys(parsed.drafts), ['fresh'])
})
test('草稿按 SDK session 隔离并可在 accepted 后清除', () => {
  let store = parseSessionDraftStore(null, 1_000)
  const firstKey = sessionDraftKey({historySessionId: 'sdk-1', workDir: 'D:/work', gatewaySessionId: 'gw-1'})
  const secondKey = sessionDraftKey({historySessionId: 'sdk-2', workDir: 'D:/work', gatewaySessionId: 'gw-2'})
  store = upsertSessionDraft(store, firstKey, '继续完成第一项', {now: 1_001, interrupted: true})
  store = upsertSessionDraft(store, secondKey, '第二项', {now: 1_002, interrupted: false})
  assert.equal(getSessionDraft(store, firstKey)?.text, '继续完成第一项')
  assert.equal(getSessionDraft(store, secondKey)?.text, '第二项')
  store = removeSessionDraft(store, firstKey)
  assert.equal(getSessionDraft(store, firstKey), null)
  assert.equal(getSessionDraft(store, secondKey)?.text, '第二项')
})

test('草稿限制文本长度和条目数量', () => {
  let store = parseSessionDraftStore(null, 1_000)
  for (let i = 0; i < 4; i++) {
    store = upsertSessionDraft(store, `sdk:${i}`, `text-${i}-abcdef`, {
      now: 1_000 + i,
      maxEntries: 3,
      maxTextLength: 8,
    })
  }
  assert.deepEqual(Object.keys(store.drafts).sort(), ['sdk:1', 'sdk:2', 'sdk:3'])
  assert.equal(store.drafts['sdk:3'].text, 'text-3-a')
})
