import test from 'node:test'
import assert from 'node:assert/strict'
import {describeAttachment, isImageAttachment} from './attachment-type.mjs'

test('Word 文档保留 docx 扩展名，不受错误 image/png MIME 影响', () => {
    const descriptor = describeAttachment('需求说明.docx', 'image/png')
    assert.equal(descriptor.extension, '.docx')
    assert.equal(descriptor.kind, 'word')
    assert.equal(isImageAttachment(descriptor), false)
})

test('常见附件按扩展名分类', () => {
    assert.equal(describeAttachment('预算.xlsx').kind, 'spreadsheet')
    assert.equal(describeAttachment('方案.pptx').kind, 'presentation')
    assert.equal(describeAttachment('截图.png').kind, 'image')
    assert.equal(describeAttachment('说明.pdf').kind, 'pdf')
})

test('未知扩展名使用 bin 存储扩展名而不伪装成 PNG', () => {
    const descriptor = describeAttachment('data.custom', 'application/octet-stream')
    assert.equal(descriptor.extension, '.bin')
    assert.equal(descriptor.kind, 'binary')
})
