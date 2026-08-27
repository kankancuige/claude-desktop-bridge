import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./views/SettingsView.vue', import.meta.url), 'utf8')

test('通用确认框在执行回调前关闭，所有调用方共享同一生命周期', () => {
  const handlerStart = source.indexOf('function acceptAppConfirm()')
  const handlerEnd = source.indexOf('\nfunction showAlert(', handlerStart)
  assert.ok(handlerStart >= 0, '缺少通用确认处理函数')
  assert.ok(handlerEnd > handlerStart, '无法定位通用确认处理函数边界')

  const handler = source.slice(handlerStart, handlerEnd)
  const closeIndex = handler.indexOf('appConfirm.value = null')
  const callbackIndex = handler.indexOf('confirmation.onOk()')
  assert.ok(closeIndex >= 0, '确认处理函数未关闭弹窗')
  assert.ok(callbackIndex > closeIndex, '必须先关闭弹窗再执行确认回调')
  assert.match(source, /@click="acceptAppConfirm"/)
  assert.doesNotMatch(source, /@click="appConfirm\.onOk"/)
})
