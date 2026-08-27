import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source = readFileSync(new URL('./views/WorkflowTab.vue', import.meta.url), 'utf8')

test('Workflow 管理操作检查 HTTP 状态并显示可见错误', () => {
  assert.match(source, /if \(!response\.ok\) throw new Error\(await readResponseError\(response, '保存 Workflow 失败'\)\)/)
  assert.match(source, /if \(!response\.ok\) throw new Error\(await readResponseError\(response, '创建 Workflow 失败'\)\)/)
  assert.match(source, /if \(!response\.ok\) throw new Error\(await readResponseError\(response, '删除 Workflow 失败'\)\)/)
  assert.match(source, /if \(!response\.ok\) throw new Error\(await readResponseError\(response, '保存 Workflow 开关失败'\)\)/)
  assert.match(source, /if \(!r\.ok\) throw new Error\(await readResponseError\(r, '加载 Workflow 开关失败'\)\)/)
  assert.match(source, /<div v-if="wfError" class="wf-error-banner" role="alert">/)
})

test('Workflow 加载和保存状态在 finally 中复位', () => {
  assert.match(source, /finally \{\s*wfLoading\.value = false\s*\}/)
  assert.match(source, /finally \{\s*wfSaving\.value = false\s*\}/)
  assert.match(source, /finally \{\s*if \(editingWfName\.value === wf\.name\) wfEditLoading\.value = false\s*\}/)
})

test('Workflow 乐观开关保存失败会恢复原状态', () => {
  assert.match(source, /const previous = wfEnabled\.value/)
  assert.match(source, /wfEnabled\.value = previous/)
  assert.match(source, /wf\.enabled = previous/)
})
