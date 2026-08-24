import test from 'node:test'
import assert from 'node:assert/strict'
import {createWorkflowConfigRuntime} from './workflow-config-runtime.mjs'

test('Workflow 配置提供默认值并可保存', () => {
    let saved
    const runtime = createWorkflowConfigRuntime({filePath: 'workflow.json', readJSON: () => ({enabled: true}), writeJSON: (path, value) => { saved = {path, value} }})
    assert.equal(runtime.loadWfConfig().enabled, true)
    runtime.saveWfConfig({enabled: false})
    assert.deepEqual(saved, {path: 'workflow.json', value: {enabled: false}})
})
