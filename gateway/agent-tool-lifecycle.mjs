const BUILTIN_AGENT_PURPOSES = Object.freeze({
    claude: '通用 Claude 助手：处理综合分析、问答和代码任务。',
    'claude-code-guide': 'Claude Code 使用指南：解释工具、工作流和最佳实践。',
    Explore: '项目探索：快速扫描目录、定位相关文件并总结代码结构。',
    'general-purpose': '通用执行代理：处理没有专门类型的复杂开发任务。',
    Plan: '方案规划：分析需求、拆分步骤并制定实现计划。',
    'statusline-setup': '状态栏配置：协助配置和调整 Claude Code 状态栏。',
})

function cleanText(value) {
    return typeof value === 'string' ? value.trim() : ''
}

export function buildAgentDescriptor(agentType, input = {}, definitions = {}) {
    const configuredPurpose = cleanText(definitions?.[agentType]?.description)
    const purpose = configuredPurpose || BUILTIN_AGENT_PURPOSES[agentType] || `执行 ${agentType || 'unknown'} 专项任务。`
    const task = cleanText(input.description) || cleanText(input.prompt)
    const scope = cleanText(input.scope)
        || (Array.isArray(input.targetFiles) ? input.targetFiles.filter(Boolean).join('、') : '')
        || cleanText(input.target)
    const currentAction = cleanText(input.currentAction)
    return {
        purpose,
        task,
        scope,
        currentAction,
        descriptionSource: task ? 'input' : configuredPurpose ? 'definition' : 'builtin',
    }
}

export function describeAgent(agentType, input = {}, definitions = {}) {
    const descriptor = buildAgentDescriptor(agentType, input, definitions)
    return descriptor.task || descriptor.purpose
}

export function buildAgentToolLifecycleEvent(toolName, input = {}, requestId, timestamp = Date.now(), definitions = {}, identity = {}) {
    if (toolName !== 'Agent' && toolName !== 'Task' && toolName !== 'Workflow') return null
    const agentType = String(input.name || input.subagent_type || 'unknown')
    const descriptor = buildAgentDescriptor(agentType, input, definitions)
    const event = {
        type: toolName === 'Workflow' ? 'workflow_started' : 'subagent_spawning',
        requestId,
        name: String(input.name || agentType),
        agentType,
        description: descriptor.task || descriptor.purpose,
        ...descriptor,
        ts: timestamp,
    }
    if (identity.toolUseId) event.toolUseId = String(identity.toolUseId)
    if (toolName === 'Workflow') {
        event.phases = Array.isArray(input.phases) ? input.phases : []
        event.workflowId = 'wf-' + event.name + '-' + Number(timestamp).toString(36)
    }
    return event
}

export function mergeAgentDescriptor(current = {}, incoming = {}) {
    return {
        purpose: cleanText(incoming.purpose) || cleanText(current.purpose),
        task: cleanText(incoming.task) || cleanText(current.task),
        scope: cleanText(incoming.scope) || cleanText(current.scope),
        currentAction: cleanText(incoming.currentAction) || cleanText(current.currentAction),
        descriptionSource: cleanText(incoming.descriptionSource) || cleanText(current.descriptionSource) || 'builtin',
    }
}
