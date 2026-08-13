import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./session-selection.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {classifySessionExistsResponse, isSameSessionSelection, resolveExistingSessionTarget, runtimeSessionMatchesHistory, shouldCloseSocketBeforeConnect, shouldReuseConnectedSession, shouldValidateSessionRuntime} = await import(moduleUrl)

const connectedSession = {
  requestedWorkDir: 'D:/work',
  requestedHistorySessionId: 'sdk-1',
  activeTabId: 'tab-1',
  tabId: 'tab-1',
  tabProjectPath: 'D:/work',
  activeProjectPath: 'D:/work',
  activeHistorySessionId: 'sdk-1',
  tabHistorySessionId: 'sdk-1',
  activeGatewaySessionId: 'gateway-1',
  tabGatewaySessionId: 'gateway-1',
  socketReadyState: 1,
  connected: true,
}

test('当前已连接会话点击时复用现有状态', () => {
  assert.equal(shouldReuseConnectedSession(connectedSession), true)
})

test('Windows 路径斜杠和大小写差异不应触发重新恢复会话', () => {
  assert.equal(shouldReuseConnectedSession({
    ...connectedSession,
    requestedWorkDir: 'D:\\Work\\',
    tabProjectPath: 'd:/work',
    activeProjectPath: 'D:/WORK/',
  }), true)
})

test('切换其他会话时继续走恢复流程', () => {
  assert.equal(shouldReuseConnectedSession({...connectedSession, requestedHistorySessionId: 'sdk-2'}), false)
})

test('WebSocket 断线时允许重新连接', () => {
  assert.equal(shouldReuseConnectedSession({...connectedSession, socketReadyState: 3, connected: false}), false)
  assert.equal(isSameSessionSelection({...connectedSession, socketReadyState: 3, connected: false}), true)
})

test('跨项目或跨标签页时不复用当前会话', () => {
  assert.equal(shouldReuseConnectedSession({...connectedSession, requestedWorkDir: 'D:/other'}), false)
  assert.equal(shouldReuseConnectedSession({...connectedSession, activeTabId: 'tab-2'}), false)
})

test('新建会话没有历史 ID 时不复用', () => {
  assert.equal(shouldReuseConnectedSession({...connectedSession, requestedHistorySessionId: undefined}), false)
})

test('切换到其他标签页时不关闭旧会话的 WebSocket', () => {
  assert.equal(shouldCloseSocketBeforeConnect('gateway-a', 'gateway-b', 1), false)
})

test('同一会话重连时关闭旧的前台 WebSocket', () => {
  assert.equal(shouldCloseSocketBeforeConnect('gateway-a', 'gateway-a', 1), true)
})

test('已关闭的旧 WebSocket 不重复关闭', () => {
  assert.equal(shouldCloseSocketBeforeConnect('gateway-a', 'gateway-a', 3), false)
})

test('exists 响应提供 Gateway ID 时优先使用实际活跃会话', () => {
  assert.equal(resolveExistingSessionTarget({exists: true, sessionId: 'gw-live'}, 'sdk-live'), 'gw-live')
  assert.equal(resolveExistingSessionTarget({exists: true}, 'gw-fallback'), 'gw-fallback')
  assert.equal(resolveExistingSessionTarget({exists: false, sessionId: 'gw-dead'}, 'sdk-live'), null)
})

test('exists 只有明确 404 才允许创建恢复会话', () => {
  assert.equal(classifySessionExistsResponse(true, 200), 'exists')
  assert.equal(classifySessionExistsResponse(false, 404), 'missing')
  assert.equal(classifySessionExistsResponse(false, 502), 'unavailable')
})

test('Gateway Session 只能复用到它实际绑定的 SDK 历史会话', () => {
  assert.equal(runtimeSessionMatchesHistory('sdk-1', 'sdk-1'), true)
  assert.equal(runtimeSessionMatchesHistory('sdk-1', undefined), true)
  assert.equal(runtimeSessionMatchesHistory('sdk-1', 'sdk-2'), false)
})

test('restart requires runtime validation even when the persisted tab identity matches', () => {
  assert.equal(shouldValidateSessionRuntime({...connectedSession, connected: false, socketReadyState: 3}), true)
  assert.equal(shouldValidateSessionRuntime(connectedSession), false)
})
