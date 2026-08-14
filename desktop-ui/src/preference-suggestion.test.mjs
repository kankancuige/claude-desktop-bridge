import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./views/WorkspaceView.vue', import.meta.url), 'utf8')

test('会话偏好提示覆盖四种操作并随标签页保存', () => {
  assert.match(source, /preferenceSuggestions: any\[\]/)
  assert.match(source, /action: 'project' \| 'global' \| 'once' \| 'dismiss'/)
  for (const action of ['project', 'global', 'once', 'dismiss']) {
    assert.match(source, new RegExp(`respondPreference\\(preferenceSuggestions\\[0\\], '${action}'\\)`))
  }
})

test('偏好保存失败时保留候选并允许重试', () => {
  assert.match(source, /case 'preference_error':[\s\S]*item\.saving = false/)
  assert.match(source, /case 'preference_suggestion_resolved':[\s\S]*filter\(item => item\.id !== msg\.suggestionId\)/)
})
