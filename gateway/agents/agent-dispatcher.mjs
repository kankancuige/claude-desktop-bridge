import {isAbsolute, relative, resolve} from 'node:path'
import {assertAgentCapabilities} from './agent-capabilities.mjs'
import {normalizeAgentResult} from './agent-result.mjs'

const REQUIRED = ['taskId', 'stepId', 'role', 'goal', 'workDir', 'modelTier', 'permissionMode']

function dispatchError(message, code) {
    return Object.assign(new Error(message), {code})
}

function normalizeInput(input = {}) {
    for (const field of REQUIRED) if (!String(input[field] || '').trim()) throw dispatchError(`Agent 输入缺少 ${field}`, 'INVALID_AGENT_INPUT')
    if (!isAbsolute(input.workDir)) throw dispatchError('Agent workDir 必须是绝对路径', 'INVALID_AGENT_INPUT')
    const targetFiles = Array.isArray(input.targetFiles) ? input.targetFiles.map(String).slice(0, 200) : []
    return {...input, targetFiles, acceptanceCriteria: Array.isArray(input.acceptanceCriteria) ? input.acceptanceCriteria.slice(0, 50) : []}
}

function inside(root, file) {
    const absolute = isAbsolute(file) ? resolve(file) : resolve(root, file)
    const rel = relative(resolve(root), absolute)
    return rel !== '..' && !rel.startsWith(`..\\`) && !rel.startsWith('../') && !isAbsolute(rel)
}

function assertChangedFiles(input, result, definition) {
    if (definition?.writable !== true && result.changedFiles.length) {
        throw dispatchError(`只读 Agent 声明修改了文件: ${result.changedFiles[0]}`, 'AGENT_SCOPE_VIOLATION')
    }
    const targets = new Set(input.targetFiles.map(file => resolve(input.workDir, file).toLowerCase()))
    for (const file of result.changedFiles) {
        if (!inside(input.workDir, file)) throw dispatchError(`Agent 修改越过项目边界: ${file}`, 'AGENT_SCOPE_VIOLATION')
        if (targets.size && !targets.has(resolve(input.workDir, file).toLowerCase())) throw dispatchError(`Agent 修改未授权目标文件: ${file}`, 'AGENT_SCOPE_VIOLATION')
    }
}

export function createAgentDispatcher({registry, execute, publish = () => {}} = {}) {
    if (!registry || typeof registry.get !== 'function' || typeof execute !== 'function') throw new TypeError('Agent Dispatcher 缺少 registry/execute')
    return {
        async dispatchAgent(rawInput) {
            const input = normalizeInput(rawInput)
            const definition = registry.get(input.agentId || input.role)
            if (!definition || !definition.enabled) throw dispatchError('Agent 不存在或已关闭', 'AGENT_UNAVAILABLE')
            if (input.permissionMode === 'plan' && definition.writable) throw dispatchError('只读权限不允许写入 Agent', 'AGENT_PERMISSION_DENIED')
            assertAgentCapabilities(input.capabilities || {}, input.requirements || {}, {provider: input.provider || 'unknown'})
            const agentRunId = String(input.agentRunId || `${input.stepId}:agent:1`)
            publish({type: 'agent/started', taskId: input.taskId, stepId: input.stepId, agentRunId, role: definition.role})
            try {
                const rawResult = await execute({...input, agentRunId, definition})
                const result = normalizeAgentResult(rawResult, {...input, agentRunId, role: definition.role})
                assertChangedFiles(input, result, definition)
                publish({type: result.status === 'completed' ? 'agent/completed' : 'agent/failed', taskId: input.taskId, stepId: input.stepId, agentRunId, role: definition.role, result})
                return result
            } catch (error) {
                publish({type: 'agent/failed', taskId: input.taskId, stepId: input.stepId, agentRunId, role: definition.role, code: error?.code || 'AGENT_EXECUTION_FAILED'})
                throw error
            }
        },
    }
}

export async function dispatchAgent(input, dependencies) {
    return createAgentDispatcher(dependencies).dispatchAgent(input)
}
