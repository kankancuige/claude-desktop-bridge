import test from 'node:test'
import assert from 'node:assert/strict'
import {createClaudeExecutableRuntime} from './claude-executable-runtime.mjs'

test('claude executable runtime prefers configured executable', () => {
    const runtime = createClaudeExecutableRuntime({homedir: () => 'D:/home', join: (...parts) => parts.join('/'), dirname: value => value.slice(0, value.lastIndexOf('/')), existsSync: value => value === 'configured.exe', readdirSync: () => [], statSync: () => ({isDirectory: () => true}), execSync: () => '', loadCliSettings: () => ({claudeExe: 'configured.exe'}), env: {}, platform: 'win32'})
    assert.equal(runtime.getClaudeExe(), 'configured.exe')
})
