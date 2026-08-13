import test from 'node:test'
import assert from 'node:assert/strict'
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
