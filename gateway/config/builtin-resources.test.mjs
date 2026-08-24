import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {ensureBuiltinResources, getBuiltinResourceState, migrateLegacyBuiltinResourceState, setBuiltinResourceEnabled} from './builtin-resources.mjs'

function withBridgeHome(run) {
    const bridgeHome = mkdtempSync(join(tmpdir(), 'bridge-builtin-'))
    try { return run(bridgeHome) } finally { rmSync(bridgeHome, {recursive: true, force: true}) }
}

function checksumSingleFile(relativePath, content) {
    return createHash('sha256')
        .update(relativePath)
        .update('\0')
        .update(content)
        .update('\0')
        .digest('hex')
}

test('首次启动安装内置资源并记录状态', () => withBridgeHome((bridgeHome) => {
    const result = ensureBuiltinResources({bridgeHome})
    assert.ok(result.installed.includes('skill:bridge-memory'))
    assert.ok(result.installed.includes('skill:diagram-design'))
    assert.ok(result.installed.includes('skill:ln-75-architecture-diagram-builder'))
    const state = getBuiltinResourceState({bridgeHome})
    const memory = state.find(item => item.type === 'skill' && item.id === 'bridge-memory')
    assert.equal(memory.installed, true)
    assert.equal(memory.enabled, true)
    assert.equal(memory.customized, false)
    assert.match(readFileSync(join(bridgeHome, 'skills', 'bridge-memory', 'SKILL.md'), 'utf8'), /name: bridge-memory/)
    assert.match(readFileSync(join(bridgeHome, 'skills', 'industrial-tightening-solution', 'SKILL.md'), 'utf8'), /name: industrial-tightening-solution/)
    assert.ok(statSync(join(bridgeHome, 'skills', 'industrial-tightening-solution', 'references', 'acceptance-and-evidence.md')).isFile())
    assert.match(readFileSync(join(bridgeHome, 'skills', 'ln-75-architecture-diagram-builder', 'SKILL.md'), 'utf8'), /name: ln-75-architecture-diagram-builder/)
    assert.match(readFileSync(join(bridgeHome, 'skills', 'diagram-design', 'SKILL.md'), 'utf8'), /name: diagram-design/)
    assert.ok(statSync(join(bridgeHome, 'skills', 'diagram-design', 'references', 'style-guide.md')).isFile())
    assert.ok(statSync(join(bridgeHome, 'skills', 'diagram-design', 'scripts')).isDirectory())
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

test('未自定义的旧内置资源升级时覆盖文件内容并刷新状态', () => withBridgeHome((bridgeHome) => {
    ensureBuiltinResources({bridgeHome})
    const relativePath = 'workflows/code-review.mjs'
    const target = join(bridgeHome, relativePath)
    const oldContent = '// historical builtin workflow\n'
    writeFileSync(target, oldContent, 'utf8')
    const targetMetadata = `${relativePath}|${Buffer.byteLength(oldContent, 'utf8')}|${Math.trunc(statSync(target).mtimeMs)}`
    const statePath = join(bridgeHome, 'builtin-resource-state.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    state.resources['workflow:code-review'] = {
        ...state.resources['workflow:code-review'],
        version: '1',
        sourceChecksum: checksumSingleFile(relativePath, oldContent),
        sourceMetadata: 'workflows/code-review.mjs|historical',
        targetChecksum: checksumSingleFile(relativePath, oldContent),
        targetMetadata,
        customized: false,
    }
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8')

    const result = ensureBuiltinResources({bridgeHome})
    assert.ok(result.updated.includes('workflow:code-review'))
    assert.equal(
        readFileSync(target, 'utf8'),
        readFileSync(join('gateway', 'builtin-resources', relativePath), 'utf8'),
    )
    assert.equal(getBuiltinResourceState({bridgeHome}).find(item => item.type === 'workflow' && item.id === 'code-review').customized, false)
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
