import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {
    MAX_WORKFLOW_SCRIPT_BYTES,
    validateWorkflowContent,
} from './workflow-runner.mjs'

test('Workflow 内容拒绝空值和纯空白', () => {
    assert.throws(() => validateWorkflowContent(), {code: 'WORKFLOW_SCRIPT_INVALID'})
    assert.throws(() => validateWorkflowContent('  \r\n'), {code: 'WORKFLOW_SCRIPT_INVALID'})
})

test('Workflow 内容按 UTF-8 字节限制为 1MB', () => {
    const exact = 'a'.repeat(MAX_WORKFLOW_SCRIPT_BYTES)
    assert.equal(validateWorkflowContent(exact), exact)
    assert.throws(
        () => validateWorkflowContent(exact + '中'),
        {code: 'WORKFLOW_SCRIPT_TOO_LARGE'},
    )
})

test('最终审查只覆盖变更文件并允许读取直接调用关系判断回归', () => {
    const source = readFileSync(new URL('./workflow-runner.mjs', import.meta.url), 'utf8')
    assert.match(source, /只审查本轮列出的变更文件，不扫描整个仓库/)
    assert.match(source, /允许读取这些文件的直接调用方和直接依赖以判断回归/)
    assert.match(source, /问题必须定位到变更文件/)
})
