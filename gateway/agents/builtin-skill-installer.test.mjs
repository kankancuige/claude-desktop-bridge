import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {
    BUILTIN_SKILL_NAMES,
    builtinSkillSourcePath,
    ensureBuiltinSkillsAvailable,
} from './builtin-skill-installer.mjs'

function withTempClaudeHome(run) {
    const bridgeHome = mkdtempSync(join(tmpdir(), 'bridge-skills-'))
    try {
        return run(bridgeHome)
    } finally {
        rmSync(bridgeHome, {recursive: true, force: true})
    }
}

test('内置数字孪生 Skill 源文件完整可读', () => {
    assert.deepEqual(BUILTIN_SKILL_NAMES, ['bridge-memory', 'digital-twin-cad'])
    const content = readFileSync(builtinSkillSourcePath('digital-twin-cad'), 'utf8')
    assert.match(content, /^---\r?\nname: digital-twin-cad/m)
    assert.match(content, /twin\.config\.yaml/)
    assert.match(content, /twin\.manifest\.json/)
    assert.match(content, /image-procedural/)
    assert.match(content, /image-proxy/)
    assert.match(content, /ObjectSculptSpec/)
})

test('Bridge Memory Skill 源文件包含治理边界', () => {
    const content = readFileSync(builtinSkillSourcePath('bridge-memory'), 'utf8')
    assert.match(content, /^---\r?\nname: bridge-memory/m)
    assert.match(content, /最近验证/)
    assert.match(content, /API Key/)
})

test('首次命中时安装内置 Skill，重复调用不覆盖已有内容', () => withTempClaudeHome(bridgeHome => {
    const first = ensureBuiltinSkillsAvailable(['digital-twin-cad'], {bridgeHome})
    assert.deepEqual(first, {available: ['digital-twin-cad'], installed: ['digital-twin-cad']})

    const target = join(bridgeHome, 'skills', 'digital-twin-cad', 'SKILL.md')
    writeFileSync(target, '用户自定义内容', 'utf8')
    const second = ensureBuiltinSkillsAvailable(['digital-twin-cad'], {bridgeHome})
    assert.deepEqual(second, {available: ['digital-twin-cad'], installed: []})
    assert.equal(readFileSync(target, 'utf8'), '用户自定义内容')
}))

test('未知 Skill 由现有配置负责，不产生内置文件', () => withTempClaudeHome(bridgeHome => {
    assert.deepEqual(ensureBuiltinSkillsAvailable(['protocol-parser'], {bridgeHome}), {
        available: ['protocol-parser'],
        installed: [],
    })
}))

test('目标目录不可创建时返回稳定错误且不留下 Skill 文件', () => withTempClaudeHome(bridgeHome => {
    const blockedHome = join(bridgeHome, 'blocked')
    writeFileSync(blockedHome, 'not-a-directory', 'utf8')
    assert.throws(
        () => ensureBuiltinSkillsAvailable(['digital-twin-cad'], {bridgeHome: blockedHome}),
        /准备 Bridge 内置 Skill 失败：digital-twin-cad/,
    )
    assert.throws(() => readFileSync(join(blockedHome, 'skills', 'digital-twin-cad', 'SKILL.md'), 'utf8'))
}))
