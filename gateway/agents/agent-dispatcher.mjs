import {isAbsolute, relative, resolve} from 'node:path'
import {assertAgentCapabilities} from './agent-capabilities.mjs'
import {normalizeAgentResult} from './agent-result.mjs'
import {canDelegateWriteToParent, normalizePermissionMode} from './agent-permission.mjs'

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
    const targets = new Set(input.targetFiles.map(file => resolve(input.workDir, file).toLowerCase()))
    const declaredFiles = [...result.changedFiles, ...(result.writeRequest?.requestedFiles || [])]
    for (const file of declaredFiles) {
        if (!inside(input.workDir, file)) throw dispatchError(`Agent 修改越过项目边界: ${file}`, 'AGENT_SCOPE_VIOLATION')
        if (targets.size && !targets.has(resolve(input.workDir, file).toLowerCase())) throw dispatchError(`Agent 修改未授权目标文件: ${file}`, 'AGENT_SCOPE_VIOLATION')
    }
    const readOnly = canDelegateWriteToParent({permissionMode: normalizePermissionMode(input.permissionMode), agentWritable: definition?.writable === true})
    if (!readOnly) return result
    const requestedFiles = [...new Set([
        ...(result.writeRequest?.requestedFiles || []),
        ...result.changedFiles,
    ])].slice(0, 50)
    if (!requestedFiles.length) return result
    return {
        ...result,
        status: 'blocked',
        changedFiles: [],
        writeRequest: {
            requestedFiles,
            requestedAction: result.writeRequest?.requestedAction || 'apply_changes',
            reason: result.writeRequest?.reason || '当前 Agent 或会话没有写入权限，请交由主任务执行',
        },
        nextAction: result.nextAction || '交由主任务执行写入后重新验证',
    }
}

export function createAgentDispatcher({registry, execute, publish = () => {}, mailbox = null} = {}) {
    if (!registry || typeof registry.get !== 'function' || typeof execute !== 'function') throw new TypeError('Agent Dispatcher 缺少 registry/execute')
    return {
        async dispatchAgent(rawInput) {
            const input = normalizeInput(rawInput)
            const definition = registry.get(input.agentId || input.role)
            if (!definition || !definition.enabled) throw dispatchError('Agent 不存在或已关闭', 'AGENT_UNAVAILABLE')
            assertAgentCapabilities(input.capabilities || {}, input.requirements || {}, {provider: input.provider || 'unknown'})
            const agentRunId = String(input.agentRunId || `${input.stepId}:agent:1`)
            const mailboxMessages = mailbox?.consume?.({toAgent: definition.role, taskId: input.taskId, limit: 20}) || []
            publish({type: 'agent/started', taskId: input.taskId, stepId: input.stepId, agentRunId, role: definition.role})
            try {
                const rawResult = await execute({...input, agentRunId, definition, mailboxMessages})
                const result = normalizeAgentResult(rawResult, {...input, agentRunId, role: definition.role})
                const safeResult = assertChangedFiles(input, result, definition)
                for (const message of mailboxMessages) mailbox?.ack?.(message.messageId, {status: safeResult.status === 'completed' ? 'consumed' : 'failed'})
                const eventType = safeResult.status === 'completed' ? 'agent/completed' : safeResult.status === 'blocked' ? 'agent/blocked' : 'agent/failed'
                publish({type: eventType, taskId: input.taskId, stepId: input.stepId, agentRunId, role: definition.role, result: safeResult})
                return safeResult
            } catch (error) {
                for (const message of mailboxMessages) mailbox?.ack?.(message.messageId, {status: 'pending'})
                publish({type: 'agent/failed', taskId: input.taskId, stepId: input.stepId, agentRunId, role: definition.role, code: error?.code || 'AGENT_EXECUTION_FAILED'})
                throw error
            }
        },
    }
}

export async function dispatchAgent(input, dependencies) {
    return createAgentDispatcher(dependencies).dispatchAgent(input)
}
