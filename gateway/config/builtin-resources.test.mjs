import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {ensureBuiltinResources, getBuiltinResourceState, migrateLegacyBuiltinResourceState, setBuiltinResourceEnabled} from './builtin-resources.mjs'

function withBridgeHome(run) {
    const bridgeHome = mkdtempSync(join(tmpdir(), 'bridge-builtin-'))
    try { return run(bridgeHome) } finally { rmSync(bridgeHome, {recursive: true, force: true}) }
}

test('首次启动安装内置资源并记录状态', () => withBridgeHome((bridgeHome) => {
    const result = ensureBuiltinResources({bridgeHome})
    assert.ok(result.installed.includes('skill:bridge-memory'))
    const state = getBuiltinResourceState({bridgeHome})
    const memory = state.find(item => item.type === 'skill' && item.id === 'bridge-memory')
    assert.equal(memory.installed, true)
    assert.equal(memory.enabled, true)
    assert.equal(memory.customized, false)
    assert.match(readFileSync(join(bridgeHome, 'skills', 'bridge-memory', 'SKILL.md'), 'utf8'), /name: bridge-memory/)
}))

test('用户修改内置资源后升级不会覆盖并标记 customized', () => withBridgeHome((bridgeHome) => {
    ensureBuiltinResources({bridgeHome})
    const file = join(bridgeHome, 'agents', 'build-error-resolver.md')
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n用户修改\n`, 'utf8')
    const result = ensureBuiltinResources({bridgeHome})
    assert.ok(result.customized.includes('agent:build-error-resolver'))
    assert.match(readFileSync(file, 'utf8'), /用户修改/)
    assert.equal(getBuiltinResourceState({bridgeHome}).find(item => item.id === 'build-error-resolver').customized, true)
}))

test('资源开关持久化且必需资源不能关闭', () => withBridgeHome((bridgeHome) => {
    ensureBuiltinResources({bridgeHome})
    const disabled = setBuiltinResourceEnabled({bridgeHome, type: 'skill', id: 'caveman', enabled: false})
    assert.equal(disabled.enabled, false)
    assert.equal(getBuiltinResourceState({bridgeHome}).find(item => item.id === 'caveman').enabled, false)
    assert.throws(
        () => setBuiltinResourceEnabled({bridgeHome, type: 'rule', id: 'bridge-rules', enabled: false}),
        error => error?.code === 'BUILTIN_RESOURCE_REQUIRED',
    )
}))

test('未知资源类型或 ID 显式失败', () => withBridgeHome((bridgeHome) => {
    ensureBuiltinResources({bridgeHome})
    assert.throws(
        () => setBuiltinResourceEnabled({bridgeHome, type: 'skill', id: 'missing', enabled: true}),
        error => error?.code === 'BUILTIN_RESOURCE_NOT_FOUND',
    )
}))

test('旧 Skill/MCP 开关只迁移 manifest 内置项并保留自定义项', () => withBridgeHome((bridgeHome) => {
    ensureBuiltinResources({bridgeHome})
    writeFileSync(join(bridgeHome, 'settings.json'), JSON.stringify({
        disabledSkills: ['caveman', 'custom-skill'],
        disabledMcpPlugins: ['ccd_directory', 'custom-mcp'],
    }), 'utf8')

    const result = migrateLegacyBuiltinResourceState({bridgeHome})
    assert.deepEqual(result.migrated, ['skill:caveman', 'mcp:ccd_directory'])
    assert.equal(getBuiltinResourceState({bridgeHome}).find(item => item.type === 'skill' && item.id === 'caveman').enabled, false)
    assert.equal(getBuiltinResourceState({bridgeHome}).find(item => item.type === 'mcp' && item.id === 'ccd_directory').enabled, false)
    const settings = JSON.parse(readFileSync(join(bridgeHome, 'settings.json'), 'utf8'))
    assert.deepEqual(settings.disabledSkills, ['custom-skill'])
    assert.deepEqual(settings.disabledMcpPlugins, ['custom-mcp'])
    assert.equal(migrateLegacyBuiltinResourceState({bridgeHome}).changed, false)
}))
