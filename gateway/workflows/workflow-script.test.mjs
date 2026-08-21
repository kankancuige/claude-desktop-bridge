import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, readdirSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {
    MAX_WORKFLOW_SCRIPT_BYTES,
    validateWorkflowContent,
} from './workflow-runner.mjs'
import {validateWorkflowSyntax} from './workflow-source.mjs'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))

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

test('所有内置 Workflow DSL 按真实 async 包装方式通过语法编译', () => {
    const root = join(TEST_DIR, '..', 'builtin-resources', 'workflows')
    const files = readdirSync(root).filter(name => name.endsWith('.mjs')).sort()
    assert.ok(files.length > 0)
    for (const name of files) {
        const source = readFileSync(join(root, name), 'utf8')
        assert.equal(validateWorkflowSyntax(source, {filename: name}), true)
        // 受限子进程明确移除了 process，内置脚本只能消费 Gateway 传入的 args。
        assert.doesNotMatch(source, /\bprocess\s*\./, `${name} 不得访问受限宿主 API`)
    }
})

test('最终审查只覆盖变更文件并允许读取直接调用关系判断回归', () => {
    const source = readFileSync(new URL('./workflow-runner.mjs', import.meta.url), 'utf8')
    assert.match(source, /只审查本轮列出的变更文件，不扫描整个仓库/)
    assert.match(source, /允许读取这些文件的直接调用方和直接依赖以判断回归/)
    assert.match(source, /问题必须定位到变更文件/)
})
