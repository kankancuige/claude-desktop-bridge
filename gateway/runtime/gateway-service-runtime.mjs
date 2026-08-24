/** Gateway 核心服务端口：状态仓储访问和 Agent Provider 启动。 */
export function createGatewayServiceRuntime({getStorageGateway = () => null, agentProvider, requirementsForAgentStart} = {}) {
    if (!agentProvider || typeof agentProvider.start !== 'function' || typeof requirementsForAgentStart !== 'function') throw new TypeError('gateway service dependencies are required')
    function stateRepositories() {
        return getStorageGateway()?.repositories || {}
    }
    function startClaudeAgent(prompt, options, requirements = {}) {
        return agentProvider.start({prompt, options}, requirementsForAgentStart({options, ...requirements}))
    }
    return {stateRepositories, startClaudeAgent}
}
