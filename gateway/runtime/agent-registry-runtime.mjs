/** 运行时 Agent 定义加载和权限能力注册。 */
export function createAgentRegistryRuntime({
    bridgeHome,
    builtinDefinitions = [],
    createAgentRegistry,
    getBuiltinResourceState,
    resolveTaskAgents,
    readdirSync,
    readFileSync,
    join,
    parseFrontmatter,
    logger = {debug() {}},
} = {}) {
    if (!bridgeHome || typeof createAgentRegistry !== 'function' || typeof getBuiltinResourceState !== 'function'
        || typeof readdirSync !== 'function' || typeof readFileSync !== 'function' || typeof join !== 'function'
        || typeof parseFrontmatter !== 'function') throw new TypeError('agent registry runtime dependencies are required')

    function loadAgentDefinitions(decision = null, projectContext = null) {
        const directory = join(bridgeHome, 'agents')
        const definitions = {}
        const builtinAgents = getBuiltinResourceState({bridgeHome}).filter(item => item.type === 'agent')
        const enabledAgents = new Set(builtinAgents.filter(item => item.enabled).map(item => item.id))
        const selectedBuiltinAgents = new Set(decision && typeof resolveTaskAgents === 'function'
            ? resolveTaskAgents(projectContext || {}, decision).map(item => item.id) : [])
        try {
            for (const filename of readdirSync(directory)) {
                if (!filename.endsWith('.md')) continue
                const resourceId = filename.replace(/\.md$/, '')
                if (builtinAgents.some(item => item.id === resourceId) && !enabledAgents.has(resourceId)) continue
                if (builtinAgents.some(item => item.id === resourceId) && !selectedBuiltinAgents.has(resourceId)) continue
                try {
                    const {frontmatter, body} = parseFrontmatter(readFileSync(join(directory, filename), 'utf8'))
                    const name = frontmatter.name || resourceId
                    const tools = frontmatter.tools ? frontmatter.tools.split(',').map(value => value.trim()).filter(Boolean) : undefined
                    definitions[name] = {
                        description: frontmatter.description || `Agent: ${name}`,
                        prompt: body?.trim() || frontmatter.description || `You are the "${name}" specialized agent.`,
                        ...(tools ? {tools} : {}), ...(frontmatter.model && frontmatter.model !== 'inherit' ? {model: frontmatter.model} : {}),
                    }
                } catch (error) { logger.debug({err: error}, '读取自定义 Agent 失败') }
            }
        } catch (error) { logger.debug({err: error}, '扫描 Agent 目录失败') }
        return definitions
    }

    function createRuntimeAgentRegistry(decision = null, projectContext = null) {
        const enabledBuiltin = new Set(getBuiltinResourceState({bridgeHome})
            .filter(item => item.type === 'agent' && item.enabled).map(item => item.id))
        const builtin = builtinDefinitions.filter(item => item.id === 'general-purpose' || enabledBuiltin.has(item.id))
        const custom = Object.entries(loadAgentDefinitions(decision, projectContext)).map(([id, definition]) => ({
            id, role: id, description: definition.description, actions: ['all'],
            writable: !/(?:reviewer|explorer|planner|validator|root-cause)/i.test(id), enabled: true,
        }))
        return createAgentRegistry({builtin, custom})
    }

    return {loadAgentDefinitions, createRuntimeAgentRegistry}
}
