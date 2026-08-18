import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import test from 'node:test'
import {prepareBridgeHome, resolveBridgeHome} from './bridge-home.mjs'

function withTempDirs(run) {
    const root = mkdtempSync(join(tmpdir(), 'bridge-home-'))
    const legacyHome = join(root, 'legacy-claude')
    const bridgeHome = join(root, 'bridge-home')
    mkdirSync(legacyHome, {recursive: true})
    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR
    try {
        return run({root, legacyHome, bridgeHome})
    } finally {
        if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
        else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
        rmSync(root, {recursive: true, force: true})
    }
}

test('默认使用独立于 Claude/Codex 的 Bridge 私有目录', () => {
    const homeDir = resolve('C:/Users/example')
    assert.equal(resolveBridgeHome({env: {}, homeDir}), join(homeDir, '.claude-desktop-bridge'))
})

test('BRIDGE_HOME 必须是绝对路径', () => {
    assert.throws(
        () => resolveBridgeHome({env: {BRIDGE_HOME: 'relative/path'}, homeDir: resolve('C:/Users/example')}),
        error => error?.code === 'BRIDGE_HOME_NOT_ABSOLUTE',
    )
})

test('迁移复制已知资源、清除供应商字段并改写旧目录引用', () => withTempDirs(({legacyHome, bridgeHome}) => {
    mkdirSync(join(legacyHome, 'skills', 'demo'), {recursive: true})
    writeFileSync(join(legacyHome, 'skills', 'demo', 'SKILL.md'), '# demo\n', 'utf8')
    writeFileSync(join(legacyHome, 'bridge-provider.json'), '{"model":"demo"}\n', 'utf8')
    writeFileSync(join(legacyHome, 'unrelated.txt'), 'skip\n', 'utf8')
    writeFileSync(join(legacyHome, 'settings.json'), JSON.stringify({
        model: 'old-model',
        env: {ANTHROPIC_API_KEY: 'secret', KEEP_ME: 'yes'},
        hooks: {PostToolUse: [{hooks: [{type: 'command', command: `node ${join(legacyHome, 'hooks', 'audit.js')}`}]}]},
        mcpServers: {demo: {command: 'node', args: [join(legacyHome, 'mcp', 'server.js')]}},
    }), 'utf8')

    const result = prepareBridgeHome({bridgeHome, legacyHome, now: () => '2026-08-18T00:00:00.000Z'})
    assert.equal(result.completed, true)
    assert.match(readFileSync(join(bridgeHome, 'skills', 'demo', 'SKILL.md'), 'utf8'), /demo/)
    assert.equal(readFileSync(join(bridgeHome, 'bridge-provider.json'), 'utf8').trim(), '{"model":"demo"}')
    assert.throws(() => readFileSync(join(bridgeHome, 'unrelated.txt'), 'utf8'))
    const settings = JSON.parse(readFileSync(join(bridgeHome, 'settings.json'), 'utf8'))
    assert.equal(settings.model, undefined)
    assert.equal(settings.env.ANTHROPIC_API_KEY, undefined)
    assert.equal(settings.env.KEEP_ME, 'yes')
    assert.match(settings.hooks.PostToolUse[0].hooks[0].command, new RegExp(bridgeHome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(settings.mcpServers.demo.args[0], new RegExp(bridgeHome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}))

test('迁移不覆盖新目录已有文件并且完成后幂等', () => withTempDirs(({legacyHome, bridgeHome}) => {
    mkdirSync(bridgeHome, {recursive: true})
    writeFileSync(join(legacyHome, 'adapters.json'), '{"source":"legacy"}\n', 'utf8')
    writeFileSync(join(bridgeHome, 'adapters.json'), '{"source":"bridge"}\n', 'utf8')

    const first = prepareBridgeHome({bridgeHome, legacyHome})
    const second = prepareBridgeHome({bridgeHome, legacyHome})

    assert.equal(readFileSync(join(bridgeHome, 'adapters.json'), 'utf8').trim(), '{"source":"bridge"}')
    assert.deepEqual(first.skipped, ['adapters.json'])
    assert.equal(second.alreadyComplete, true)
}))

test('已有目标目录会补齐缺失文件但不覆盖已有文件', () => withTempDirs(({legacyHome, bridgeHome}) => {
    mkdirSync(join(legacyHome, 'skills', 'demo'), {recursive: true})
    mkdirSync(join(bridgeHome, 'skills', 'demo'), {recursive: true})
    writeFileSync(join(legacyHome, 'skills', 'demo', 'keep.md'), 'legacy\n', 'utf8')
    writeFileSync(join(legacyHome, 'skills', 'demo', 'missing.md'), 'copied\n', 'utf8')
    writeFileSync(join(bridgeHome, 'skills', 'demo', 'keep.md'), 'bridge\n', 'utf8')

    prepareBridgeHome({bridgeHome, legacyHome})

    assert.equal(readFileSync(join(bridgeHome, 'skills', 'demo', 'keep.md'), 'utf8'), 'bridge\n')
    assert.equal(readFileSync(join(bridgeHome, 'skills', 'demo', 'missing.md'), 'utf8'), 'copied\n')
}))

test('失败迁移保留清单并可在修复源文件后重试', () => withTempDirs(({legacyHome, bridgeHome}) => {
    writeFileSync(join(legacyHome, 'settings.json'), '{ invalid json', 'utf8')
    assert.throws(
        () => prepareBridgeHome({bridgeHome, legacyHome}),
        error => error?.code === 'BRIDGE_HOME_MIGRATION_FAILED',
    )
    const failed = JSON.parse(readFileSync(join(bridgeHome, '.bridge-migration-v1.json'), 'utf8'))
    assert.equal(failed.completed, false)
    assert.equal(failed.failures[0].name, 'settings.json')

    writeFileSync(join(legacyHome, 'settings.json'), '{"mcpServers":{}}\n', 'utf8')
    const recovered = prepareBridgeHome({bridgeHome, legacyHome})
    assert.equal(recovered.completed, true)
    assert.deepEqual(JSON.parse(readFileSync(join(bridgeHome, 'settings.json'), 'utf8')), {mcpServers: {}})
}))

test('拒绝把 Claude 目录本身作为 Bridge 私有目录', () => withTempDirs(({legacyHome}) => {
    assert.throws(
        () => prepareBridgeHome({bridgeHome: legacyHome, legacyHome}),
        error => error?.code === 'BRIDGE_HOME_NOT_ISOLATED',
    )
}))
