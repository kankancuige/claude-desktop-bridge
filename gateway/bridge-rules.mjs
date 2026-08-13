import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const RULES_PATH = join(dirname(fileURLToPath(import.meta.url)), 'BRIDGE_RULES.md')

export const BRIDGE_RULES_PATH = RULES_PATH
export const BRIDGE_RULES = readFileSync(RULES_PATH, 'utf8').trim()

export function appendBridgeRules(systemPrompt) {
    const rules = `\n\n===== Bridge 自有长期规则 =====\n${BRIDGE_RULES}\n===== Bridge 自有长期规则结束 =====`
    if (!systemPrompt) return {type: 'preset', preset: 'claude_code', append: rules.trim()}
    if (typeof systemPrompt === 'string') return `${systemPrompt}${rules}`
    if (systemPrompt.type === 'preset' && systemPrompt.preset === 'claude_code') {
        return {...systemPrompt, append: `${systemPrompt.append || ''}${rules}`.trim()}
    }
    return systemPrompt
}
