import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./attachment-description.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {attachmentKindLabel} = await import(moduleUrl)

test('服务端 word 类型显示为 Word 文档', () => {
  assert.equal(attachmentKindLabel('word', '需求说明.docx'), 'Word 文档')
})

test('服务端类型缺失时仍按 docx 扩展名识别 Word 文档', () => {
  assert.equal(attachmentKindLabel(undefined, '需求说明.docx'), 'Word 文档')
})

test('图片和 PDF 不会被标记为 Word 文档', () => {
  assert.equal(attachmentKindLabel('image', '截图.png'), '图片')
  assert.equal(attachmentKindLabel('pdf', '说明.pdf'), 'PDF 文档')
})
