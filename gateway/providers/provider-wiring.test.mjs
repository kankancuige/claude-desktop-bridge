import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const indexSource = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
const workflowSource = readFileSync(new URL('../workflows/workflow-runner.mjs', import.meta.url), 'utf8')

test('Claude SDK query 只在 Provider 注册适配器中直接调用', () => {
    const directCalls = indexSource.match(/\bquery\(\{prompt\s*,\s*options\}\)/g) || []
    assert.equal(directCalls.length, 1)
    assert.doesNotMatch(indexSource, /\bquery\(\{prompt:\s*(?:pushStream|rebuildPushStream)/)
    assert.doesNotMatch(workflowSource, /_deps\.query\(/)
})

test('Workflow 使用 Provider handle，Gateway 关闭时释放 Registry', () => {
    assert.match(indexSource, /setDeps\(\{agentProvider:\s*claudeAgentProvider/)
    assert.match(workflowSource, /_deps\.agentProvider\.start\(/)
    assert.match(indexSource, /providerRegistry\.disposeAll\(\)/)
})
