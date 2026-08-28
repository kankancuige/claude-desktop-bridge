import test from 'node:test'
import assert from 'node:assert/strict'
import {createClaudeExecutableRuntime} from './claude-executable-runtime.mjs'

test('claude executable runtime prefers configured executable', () => {
    const runtime = createClaudeExecutableRuntime({homedir: () => 'D:/home', join: (...parts) => parts.join('/'), dirname: value => value.slice(0, value.lastIndexOf('/')), existsSync: value => value === 'configured.exe', readdirSync: () => [], statSync: () => ({isDirectory: () => true}), execSync: () => '', loadCliSettings: () => ({claudeExe: 'configured.exe'}), env: {}, platform: 'win32'})
    assert.equal(runtime.getClaudeExe(), 'configured.exe')
})

test('未显式配置时优先使用 SDK 配套 executable，不自动选用用户目录旧版 CLI', () => {
    const runtime = createClaudeExecutableRuntime({
        homedir: () => 'D:/home',
        join: (...parts) => parts.join('/'),
        dirname: value => value.slice(0, value.lastIndexOf('/')),
        existsSync: value => value === 'sdk-bundled.exe' || value.includes('/Claude-3p/claude-code'),
        readdirSync: () => ['2.1.181'],
        statSync: () => ({isDirectory: () => true}),
        execSync: () => '',
        loadCliSettings: () => ({}), bundledExecutable: 'sdk-bundled.exe', env: {}, platform: 'win32',
    })
    assert.equal(runtime.getClaudeExe(), 'sdk-bundled.exe')
})
