import {readFileSync} from 'node:fs'
import {dirname, isAbsolute, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {BRIDGE_HOME} from '../config/bridge-home.mjs'
import {getBuiltinResourceState} from '../config/builtin-resources.mjs'

const CONTEXT_DIR = dirname(fileURLToPath(import.meta.url))
const RULES_PATH = join(CONTEXT_DIR, 'BRIDGE_RULES.md')
const PROJECT_RULES_PATH = join(CONTEXT_DIR, 'BRIDGE_PROJECT_RULES.md')

export const BRIDGE_RULES_PATH = RULES_PATH
export const BRIDGE_PROJECT_RULES_PATH = PROJECT_RULES_PATH
export const BRIDGE_REPOSITORY_ROOT = resolve(CONTEXT_DIR, '..', '..')
export const BRIDGE_RULES = readFileSync(RULES_PATH, 'utf8').trim()
export const BRIDGE_PROJECT_RULES = readFileSync(PROJECT_RULES_PATH, 'utf8').trim()

function loadBundledRule(id, fallback) {
    const resource = getBuiltinResourceState({bridgeHome: BRIDGE_HOME}).find(item => item.type === 'rule' && item.id === id)
    if (!resource?.enabled) return ''
    try {
        const content = readFileSync(join(BRIDGE_HOME, 'rules', id === 'bridge-rules' ? 'BRIDGE_RULES.md' : 'BRIDGE_PROJECT_RULES.md'), 'utf8')
        return content.trim()
    } catch {
        return fallback
    }
}

function appendRuleBlock(systemPrompt, title, content) {
    const rules = `\n\n===== ${title} =====\n${content}\n===== ${title}结束 =====`
    if (!systemPrompt) return {type: 'preset', preset: 'claude_code', append: rules.trim()}
    if (typeof systemPrompt === 'string') return `${systemPrompt}${rules}`
    if (systemPrompt.type === 'preset' && systemPrompt.preset === 'claude_code') {
        return {...systemPrompt, append: `${systemPrompt.append || ''}${rules}`.trim()}
    }
    return systemPrompt
}

export function isBridgeRepositoryWorkDir(workDir) {
    if (typeof workDir !== 'string' || !workDir.trim() || !isAbsolute(workDir.trim())) return false
    const candidate = resolve(workDir.trim())
    const child = relative(BRIDGE_REPOSITORY_ROOT, candidate)
    return child === '' || (child !== '..' && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(child))
}

export function appendBridgeRules(systemPrompt, {workDir = ''} = {}) {
    const globalPrompt = appendRuleBlock(systemPrompt, 'Bridge 自有长期规则', loadBundledRule('bridge-rules', BRIDGE_RULES))
    return isBridgeRepositoryWorkDir(workDir)
        ? appendRuleBlock(globalPrompt, 'Bridge 仓库专属规则', loadBundledRule('bridge-project-rules', BRIDGE_PROJECT_RULES))
        : globalPrompt
}
