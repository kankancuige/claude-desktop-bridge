import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {getBuiltinResourceState, loadBuiltinResourceManifest} from '../config/builtin-resources.mjs'

function issue(code, severity, resource, detail) {
    return {code, severity, resource, detail}
}

export function checkAiLayerHealth({bridgeHome, manifest = loadBuiltinResourceManifest(), resourceState = null} = {}) {
    const state = resourceState || getBuiltinResourceState({bridgeHome})
    const issues = []
    const keys = new Set()
    for (const resource of manifest.resources || []) {
        const key = `${resource.type}:${resource.id}`
        if (keys.has(key)) issues.push(issue('duplicate_manifest_entry', 'error', key, 'manifest 资源键重复'))
        keys.add(key)
        const current = state.find(item => item.type === resource.type && item.id === resource.id)
        if (!current?.installed) issues.push(issue('resource_missing', resource.required ? 'error' : 'warning', key, '内置资源未安装'))
        if (resource.required && current?.enabled === false) issues.push(issue('required_resource_disabled', 'error', key, '必需资源被关闭'))
        if (current?.customized) issues.push(issue('resource_customized', 'info', key, '用户已修改，升级不会覆盖'))
        if (current?.installed && resource.type === 'rule') {
            try {
                const content = readFileSync(join(bridgeHome, resource.target), 'utf8')
                if (content.includes('\uFFFD')) issues.push(issue('rule_encoding_invalid', 'error', key, '规则文件包含 UTF-8 替换字符'))
            } catch {
                issues.push(issue('rule_read_failed', 'warning', key, '规则文件无法读取'))
            }
        }
    }
    for (const current of state) {
        if (!keys.has(`${current.type}:${current.id}`)) issues.push(issue('state_orphan', 'warning', `${current.type}:${current.id}`, '安装状态没有对应 manifest 条目'))
    }
    const enabledByType = Object.fromEntries(['skill', 'rule', 'agent', 'hook', 'command', 'workflow', 'mcp'].map(type => [type, state.filter(item => item.type === type && item.enabled).length]))
    return {
        version: 1,
        healthy: !issues.some(item => item.severity === 'error'),
        checkedAt: Date.now(),
        totals: {resources: state.length, installed: state.filter(item => item.installed).length, enabled: state.filter(item => item.enabled).length, customized: state.filter(item => item.customized).length},
        enabledByType,
        issues,
        driftCandidates: issues.filter(item => ['resource_customized', 'state_orphan'].includes(item.code)),
    }
}

export function detectRuleDrift({executionReports = [], pitfalls = []} = {}) {
    const candidates = []
    const missedSkills = new Map()
    for (const report of executionReports) {
        for (const skill of report.skills?.requested || []) {
            if (!(report.skills?.matched || []).includes(skill)) missedSkills.set(skill, (missedSkills.get(skill) || 0) + 1)
        }
    }
    for (const [skill, occurrences] of missedSkills) if (occurrences >= 2) candidates.push({type: 'skill_route_gap', skill, occurrences})
    for (const pitfall of pitfalls) if (pitfall.status === 'confirmed' && !pitfall.prevention) candidates.push({type: 'prevention_missing', pitfallId: pitfall.id})
    return candidates
}
