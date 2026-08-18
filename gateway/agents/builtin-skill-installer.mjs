import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const BUILTIN_SKILL_SOURCES = new Map([
    ['bridge-memory', join(MODULE_DIR, 'builtin-skills', 'bridge-memory', 'SKILL.md')],
    ['digital-twin-cad', join(MODULE_DIR, 'builtin-skills', 'digital-twin-cad', 'SKILL.md')],
])

export const BUILTIN_SKILL_NAMES = Object.freeze([...BUILTIN_SKILL_SOURCES.keys()])

export function builtinSkillSourcePath(name) {
    const source = BUILTIN_SKILL_SOURCES.get(name)
    if (!source) throw new Error(`未知的 Bridge 内置 Skill: ${name}`)
    return source
}

/**
 * 只在首次路由命中时准备 Bridge 内置 Skill；已有同名文件视为用户所有，不覆盖。
 * 未列入内置集合的 Skill 继续由现有设置和安装流程负责。
 */
export function ensureBuiltinSkillsAvailable(skillNames, {bridgeHome} = {}) {
    if (typeof bridgeHome !== 'string' || !bridgeHome.trim()) {
        throw new Error('准备 Bridge 内置 Skill 失败：Bridge 私有目录无效')
    }

    const available = [...new Set(
        (Array.isArray(skillNames) ? skillNames : [])
            .filter(name => typeof name === 'string' && name.length <= 128),
    )]
    const installed = []

    for (const name of available) {
        const source = BUILTIN_SKILL_SOURCES.get(name)
        if (!source) continue

        const target = join(bridgeHome, 'skills', name, 'SKILL.md')
        if (existsSync(target)) continue

        let temporaryPath = ''
        try {
            const content = readFileSync(source, 'utf8')
            if (!content.trim() || !new RegExp(`^name:\\s*${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*$`, 'm').test(content)) {
                throw new Error('内置源文件无效')
            }

            const targetDir = dirname(target)
            mkdirSync(targetDir, {recursive: true})
            temporaryPath = join(targetDir, `.SKILL.md.${process.pid}.${randomUUID()}.tmp`)
            writeFileSync(temporaryPath, content, {encoding: 'utf8', flag: 'wx'})
            renameSync(temporaryPath, target)
            temporaryPath = ''
            installed.push(name)
        } catch (error) {
            // 并发 Query 可能已经完成首次安装；只接受目标文件确实存在的竞争结果。
            if (!existsSync(target)) {
                throw new Error(`准备 Bridge 内置 Skill 失败：${name}`, {cause: error})
            }
        } finally {
            if (temporaryPath) rmSync(temporaryPath, {force: true})
        }
    }

    return {available, installed}
}
