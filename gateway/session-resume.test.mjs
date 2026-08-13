import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveSessionResume} from './session-resume.mjs'

test('an explicit existing SDK transcript wins over a stale forward mapping', () => {
  assert.deepEqual(resolveSessionResume({
    requestedResume: 'sdk-clicked',
    mappedSdkSessionId: 'sdk-stale',
    transcriptExists: true,
  }), {
    mode: 'resume', gatewaySessionId: 'sdk-clicked', sdkSessionId: 'sdk-clicked',
  })
})

test('a reverse mapping may select the Gateway runtime but cannot change the SDK conversation', () => {
  assert.deepEqual(resolveSessionResume({
    requestedResume: 'sdk-clicked',
    mappedGatewaySessionId: 'gw-old',
    transcriptExists: true,
  }), {
    mode: 'resume', gatewaySessionId: 'gw-old', sdkSessionId: 'sdk-clicked',
  })
})

test('an active Gateway key bound to another SDK conversation is not reused', () => {
  assert.deepEqual(resolveSessionResume({
    requestedResume: 'sdk-clicked',
    activeGatewaySessionId: 'sdk-clicked',
    activeSdkSessionId: 'sdk-other',
    transcriptExists: true,
    newGatewaySessionId: 'gw-new',
  }), {
    mode: 'resume', gatewaySessionId: 'gw-new', sdkSessionId: 'sdk-clicked',
  })
})

test('未请求 resume 时创建新会话', () => {
  assert.deepEqual(resolveSessionResume({}), {mode: 'new', gatewaySessionId: null, sdkSessionId: null})
})

test('支持 Gateway 正向映射和 SDK 反向映射', () => {
  assert.deepEqual(resolveSessionResume({requestedResume: 'gw-1', mappedSdkSessionId: 'sdk-1'}), {
    mode: 'resume', gatewaySessionId: 'gw-1', sdkSessionId: 'sdk-1',
  })
  assert.deepEqual(resolveSessionResume({requestedResume: 'sdk-2', mappedGatewaySessionId: 'gw-2'}), {
    mode: 'resume', gatewaySessionId: 'gw-2', sdkSessionId: 'sdk-2',
  })
})

test('存在 transcript 的 SDK ID 可以直接恢复', () => {
  assert.deepEqual(resolveSessionResume({requestedResume: 'sdk-3', transcriptExists: true}), {
    mode: 'resume', gatewaySessionId: 'sdk-3', sdkSessionId: 'sdk-3',
  })
})

test('显式 resume 缺失时返回 missing，不允许伪装成新会话', () => {
  assert.deepEqual(resolveSessionResume({requestedResume: 'missing'}), {
    mode: 'missing', gatewaySessionId: null, sdkSessionId: null,
  })
})

test('内存中已有的 runtime 会话优先复用 Gateway ID', () => {
  assert.deepEqual(resolveSessionResume({
    requestedResume: 'sdk-live',
    activeGatewaySessionId: 'gw-live',
    activeSdkSessionId: 'sdk-live',
  }), {
    mode: 'resume', gatewaySessionId: 'gw-live', sdkSessionId: 'sdk-live',
  })
})

test('旧客户端按 Gateway UUID 恢复时复用 runtime 绑定的 SDK conversation', () => {
  assert.deepEqual(resolveSessionResume({
    requestedResume: 'gw-live',
    activeGatewaySessionId: 'gw-live',
    activeSdkSessionId: 'sdk-live',
    transcriptExists: false,
  }), {
    mode: 'resume', gatewaySessionId: 'gw-live', sdkSessionId: 'sdk-live',
  })
})
