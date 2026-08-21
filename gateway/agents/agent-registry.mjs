const BUILTIN_AGENT_DEFINITIONS = Object.freeze([
    {id: 'coordinator', role: 'coordinator', actions: ['all'], writable: false, description: '统一任务状态、阶段与完成门禁'},
    {id: 'explorer', role: 'explorer', actions: ['inspect', 'review', 'implement', 'refactor'], writable: false, description: '有界读取项目结构、调用链和影响面'},
    {id: 'planner', role: 'planner', actions: ['refactor', 'operate'], writable: false, description: '拆解复杂任务和验收标准'},
    {id: 'developer', role: 'developer', actions: ['implement', 'refactor'], writable: true, description: '实现通用代码变更'},
    {id: 'general-purpose', role: 'general-purpose', actions: ['all'], writable: true, description: '兼容未指定专用角色的通用 Agent'},
    {id: 'frontend-developer', role: 'frontend-developer', actions: ['implement', 'refactor'], writable: true, languages: ['JavaScript', 'TypeScript', 'Vue'], description: '实现前端代码与交互'},
    {id: 'backend-developer', role: 'backend-developer', actions: ['implement', 'refactor'], writable: true, languages: ['Java', 'C#', 'Go', 'Rust', 'Python', 'JavaScript', 'TypeScript'], description: '实现后端与服务代码'},
    {id: 'test-engineer', role: 'test-engineer', actions: ['implement', 'refactor', 'review'], writable: true, description: '编写并执行最小充分测试'},
    {id: 'build-validator', role: 'build-validator', actions: ['implement', 'refactor', 'operate'], writable: false, description: '执行受信构建命令'},
    {id: 'runtime-validator', role: 'runtime-validator', actions: ['implement', 'refactor', 'operate'], writable: false, description: '验证目标项目运行时行为'},
    {id: 'reviewer', role: 'reviewer', actions: ['review', 'refactor', 'implement'], writable: false, description: '定向审查本次风险范围'},
    {id: 'root-cause-agent', role: 'root-cause-agent', actions: ['implement', 'refactor', 'operate', 'review'], writable: false, description: '重复失败后建立完整因果链并提出新策略'},
    {id: 'security-reviewer', role: 'security-reviewer', actions: ['review', 'refactor', 'implement'], writable: false, risks: ['critical'], description: '审查认证、权限和敏感数据风险'},
    {id: 'release-validator', role: 'release-validator', actions: ['operate'], writable: false, description: '核对发布、迁移和回滚证据'},
])

function normalizeDefinition(input, source = 'user') {
    if (!input || typeof input !== 'object') throw new TypeError('Agent 定义必须是对象')
    const id = String(input.id || input.name || '').trim()
    const role = String(input.role || input.type || id).trim()
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(id) || !role) throw new TypeError('Agent 定义缺少有效 id/role')
    return Object.freeze({
        ...input,
        id,
        role,
        source: input.source === 'builtin' ? 'builtin' : source,
        actions: Array.isArray(input.actions) ? [...new Set(input.actions.map(String))] : ['all'],
        languages: Array.isArray(input.languages) ? [...new Set(input.languages.map(String))] : [],
        risks: Array.isArray(input.risks) ? [...new Set(input.risks.map(String))] : [],
        writable: input.writable === true,
        enabled: input.enabled !== false,
    })
}

export function createAgentRegistry({builtin = BUILTIN_AGENT_DEFINITIONS, custom = []} = {}) {
    const definitions = new Map()
    const registerAgent = (definition, source = 'user') => {
        const normalized = normalizeDefinition(definition, source)
        definitions.set(normalized.id, normalized)
        return normalized
    }
    for (const definition of builtin) registerAgent({...definition, source: 'builtin'}, 'builtin')
    for (const definition of custom) registerAgent(definition, 'user')
    return {
        registerAgent,
        get(id) {
            return definitions.get(String(id || '')) || null
        },
        list({enabledOnly = false} = {}) {
            return [...definitions.values()].filter(item => !enabledOnly || item.enabled)
        },
        resolveAgents(context = {}, decision = {}) {
            if (decision.complexity === 'light' && decision.action !== 'inspect') return []
            const roles = decision.complexity === 'power'
                ? ['explorer', 'planner', 'developer', 'test-engineer', 'reviewer']
                : decision.action === 'inspect' ? ['explorer']
                    : decision.action === 'review' ? ['reviewer'] : ['developer', 'test-engineer']
            if (decision.risk === 'critical') roles.push('security-reviewer')
            const languages = new Set([...(context.languages || []), ...(context.frameworks || [])])
            const max = decision.complexity === 'power' ? Math.min(8, Math.max(3, Number(context.maxAgents) || 6)) : decision.action === 'inspect' ? 1 : 2
            return roles.map(role => [...definitions.values()].find(item => item.enabled && item.role === role && (item.actions.includes('all') || item.actions.includes(decision.action)) && (!item.languages.length || item.languages.some(language => languages.has(language)))))
                .filter(Boolean).slice(0, max)
        },
    }
}

export function registerAgent(definition) {
    return createAgentRegistry({builtin: []}).registerAgent(definition)
}

export function resolveAgents(context, decision) {
    return createAgentRegistry().resolveAgents(context, decision)
}

export {BUILTIN_AGENT_DEFINITIONS}
