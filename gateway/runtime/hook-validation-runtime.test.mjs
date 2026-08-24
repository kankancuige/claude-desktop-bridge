import test from 'node:test'
import assert from 'node:assert/strict'
import {createHookValidationRuntime} from './hook-validation-runtime.mjs'

test('Hook 校验只报告缺失脚本', () => {
    const warnings = []
    const runtime = createHookValidationRuntime({
        bridgeHome: 'home', joinPath: (...parts) => parts.join('/'), basename: value => value.split('/').pop(),
        readJSON: () => ({hooks: {PreToolUse: [{hooks: [{type: 'command', command: 'node hooks/missing.mjs'}]}]}}),
        safeBasename: (root, file) => `${root}/${file}`, exists: () => false, logger: {warn: value => warnings.push(value)},
    })
    runtime.validateHooks()
    assert.equal(warnings.length, 1)
})
