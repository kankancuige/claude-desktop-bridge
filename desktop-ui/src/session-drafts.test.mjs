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
  removeMatchingInterruptedSessionDraft,
  sessionDraftKey,
  shouldRestoreSessionDraft,
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

test('重启只在服务端确认任务中断且可继续时恢复中断草稿', () => {
  const unsent = {text: '尚未发送', updatedAt: 1_000, interrupted: false}
  const interrupted = {text: '上一个任务', updatedAt: 1_001, interrupted: true}

  assert.equal(shouldRestoreSessionDraft(unsent, null), true)
  assert.equal(shouldRestoreSessionDraft(interrupted, null), false)
  assert.equal(shouldRestoreSessionDraft(interrupted, {status: 'succeeded', resumable: false}), false)
  assert.equal(shouldRestoreSessionDraft(interrupted, {status: 'interrupted', resumable: true}), true)
  assert.equal(shouldRestoreSessionDraft(interrupted, {status: 'stopped', resumable: true}), true)
})

test('成功终态只清理与已完成原任务匹配的中断草稿', () => {
  const key = 'sdk:completed'
  let store = upsertSessionDraft(parseSessionDraftStore(null, 1_000), key, '原任务', {
    now: 1_001,
    interrupted: true,
  })
  store = removeMatchingInterruptedSessionDraft(store, key, '其他任务')
  assert.equal(getSessionDraft(store, key)?.text, '原任务')

  store = removeMatchingInterruptedSessionDraft(store, key, '原任务')
  assert.equal(getSessionDraft(store, key), null)

  store = upsertSessionDraft(store, key, '用户新草稿', {now: 1_002, interrupted: false})
  store = removeMatchingInterruptedSessionDraft(store, key, '用户新草稿')
  assert.equal(getSessionDraft(store, key)?.text, '用户新草稿')
})
