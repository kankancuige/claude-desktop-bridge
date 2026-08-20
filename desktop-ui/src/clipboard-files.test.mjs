import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./clipboard-files.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {collectClipboardFiles} = await import(moduleUrl)

const file = (name, type, size = 12) => ({name, type, size, lastModified: 1})

test('纯文本剪贴板不会被识别为附件', () => {
  const data = {items: [{type: 'text/plain', getAsFile: () => null}], files: []}
  assert.deepEqual(collectClipboardFiles(data), [])
})

test('图片和普通文件都能从 items 提取', () => {
  const image = file('截图.png', 'image/png')
  const document = file('需求.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  const data = {
    items: [
      {type: 'image/png', getAsFile: () => image},
      {type: 'application/octet-stream', getAsFile: () => document},
    ],
    files: [],
  }
  assert.deepEqual(collectClipboardFiles(data), [image, document])
})

test('资源管理器回退到 files 时仍能提取普通文件且不重复', () => {
  const document = file('说明.pdf', 'application/pdf')
  const data = {
    items: [{type: 'application/pdf', getAsFile: () => document}],
    files: [document],
  }
  assert.deepEqual(collectClipboardFiles(data), [document])
})
