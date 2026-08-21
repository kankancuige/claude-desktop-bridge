import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./project-load-retry.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {PROJECT_LOAD_RETRY_DELAYS_MS, nextProjectLoadRetry} = await import(moduleUrl)

test('项目首屏加载按固定且有限的退避计划重试', () => {
  assert.deepEqual(PROJECT_LOAD_RETRY_DELAYS_MS, [400, 1_000, 2_000, 4_000])
  assert.deepEqual(nextProjectLoadRetry(0, false), {attempt: 1, delayMs: 400})
  assert.deepEqual(nextProjectLoadRetry(3, false), {attempt: 4, delayMs: 4_000})
  assert.equal(nextProjectLoadRetry(4, false), null)
})

test('已有待执行重试时不重复调度', () => {
  assert.equal(nextProjectLoadRetry(0, true), null)
})
