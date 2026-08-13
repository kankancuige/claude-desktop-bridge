import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./large-input.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {buildLargeInputPrompt, createLargeInputParts, planLargeInput, utf8ByteLength} = await import(moduleUrl)

test('UTF-8 字节数按中文三字节计算', () => {
  assert.equal(utf8ByteLength('中文A'), 7)
})

test('低于阈值的输入保持原样', () => {
  const plan = planLargeInput('普通任务', {thresholdBytes: 100})
  assert.equal(plan.converted, false)
  assert.equal(plan.prompt, '普通任务')
  assert.equal(plan.filename, '')
})

test('超过阈值时生成确定的 txt 文件名和短任务预览', () => {
  const text = `开头任务要求\n${'中间内容'.repeat(5000)}\n结尾验收要求`
  const plan = planLargeInput(text, {thresholdBytes: 100, now: new Date(2026, 7, 13, 9, 8, 7).getTime()})
  assert.equal(plan.converted, true)
  assert.equal(plan.filename, 'long-input-20260813-090807.txt')
  assert.match(plan.prompt, /请先使用 Read 工具完整读取/)
  assert.match(plan.prompt, /开头任务要求/)
  assert.match(plan.prompt, /结尾验收要求/)
  assert.ok(utf8ByteLength(plan.prompt) < 40_000)
})

test('默认 80KB 阈值会在 Gateway 的 100KB taskText 限制前转换', () => {
  const text = '中'.repeat(30_000)
  const plan = planLargeInput(text, {now: 0})
  assert.equal(plan.converted, true)
  assert.equal(plan.bytes, 90_000)
  assert.ok(utf8ByteLength(plan.prompt) < 100_000)
})

test('超过单文件上传限制时按 UTF-8 边界分片且可无损还原', () => {
  const text = `开头😀${'中文与ASCII-123\n'.repeat(800)}结尾`
  const parts = createLargeInputParts(text, 'long-input-20260813-090807.txt', 1024)
  assert.ok(parts.length > 1)
  assert.equal(parts.map(part => part.text).join(''), text)
  assert.ok(parts.every(part => part.bytes <= 1024))
  assert.match(parts[0].filename, /part-001-of-/)
  assert.doesNotThrow(() => new TextDecoder('utf-8', {fatal: true}).decode(new TextEncoder().encode(parts[0].text)))

  const prompt = buildLargeInputPrompt(text, parts.map(part => part.filename))
  assert.match(prompt, /按编号顺序完整读取全部分片附件/)
  assert.ok(prompt.includes(parts[parts.length - 1].filename))
  assert.ok(utf8ByteLength(prompt) < 100_000)
})
