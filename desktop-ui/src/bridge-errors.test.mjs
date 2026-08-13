import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./bridge-errors.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {classifyBridgeFailure, sanitizeErrorMessage, shouldNotifyHttpStatus} = await import(moduleUrl)

test('网络、超时、认证和限流错误产生稳定提示', () => {
  assert.equal(classifyBridgeFailure({error: new TypeError('Failed to fetch'), path: '/api/projects'}).code, 'GATEWAY_UNAVAILABLE')
  assert.equal(classifyBridgeFailure({error: new DOMException('timed out', 'TimeoutError'), path: '/api/projects'}).code, 'GATEWAY_TIMEOUT')
  assert.equal(classifyBridgeFailure({status: 403, path: '/api/projects'}).code, 'GATEWAY_AUTH_FAILED')
  assert.equal(classifyBridgeFailure({status: 429, path: '/api/config/live-models'}).code, 'API_RATE_LIMITED')
  assert.equal(classifyBridgeFailure({status: 502, path: '/api/config/live-models'}).code, 'GATEWAY_SERVER_ERROR')
})

test('错误文案会隐藏 bearer、API key 和常见 secret', () => {
  const text = sanitizeErrorMessage('Bearer abc.def apiKey=sk-secret token: 1234567890 password=hunter2')
  assert.equal(text.includes('abc.def'), false)
  assert.equal(text.includes('sk-secret'), false)
  assert.equal(text.includes('1234567890'), false)
  assert.equal(text.includes('hunter2'), false)
  assert.match(text, /\[REDACTED\]/)
})

test('全局层只提示可操作的传输状态，业务 4xx 留给调用方', () => {
  assert.equal(shouldNotifyHttpStatus(400), false)
  assert.equal(shouldNotifyHttpStatus(404), false)
  assert.equal(shouldNotifyHttpStatus(409), false)
  assert.equal(shouldNotifyHttpStatus(403), true)
  assert.equal(shouldNotifyHttpStatus(429), true)
  assert.equal(shouldNotifyHttpStatus(500), true)
})

test('本地持久化失败使用明确且不泄漏底层数据的提示', () => {
  const notice = classifyBridgeFailure({
    error: new Error('QuotaExceededError apiKey=sk-sensitive'),
    source: 'storage',
    path: 'bridge-session-drafts-v1',
  })
  assert.equal(notice.code, 'LOCAL_STORAGE_FAILED')
  assert.equal(notice.retryable, false)
  assert.equal(notice.message.includes('sk-sensitive'), false)
})
