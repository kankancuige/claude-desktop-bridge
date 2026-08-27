const STATUSES = new Set(['completed', 'failed', 'blocked', 'inconclusive', 'cancelled'])

function text(value, max = 2000) {
    return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function strings(value, max = 100, itemMax = 1000) {
    return Array.isArray(value) ? value.slice(0, max).map(item => text(item, itemMax)).filter(Boolean) : []
}

function normalizeWriteRequest(value, fallbackFiles = []) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const requestedFiles = strings(source.requestedFiles || fallbackFiles, 50, 500)
    if (!requestedFiles.length) return null
    return {
        requestedFiles,
        requestedAction: text(source.requestedAction || source.action, 160) || 'apply_changes',
        reason: text(source.reason, 1200) || 'Agent 需要由主任务执行文件写入',
    }
}

export function normalizeAgentResult(value = {}, identity = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw Object.assign(new TypeError('AgentResult 必须是对象'), {code: 'INVALID_AGENT_RESULT'})
    }
    const status = STATUSES.has(value.status) ? value.status : null
    if (!status) throw Object.assign(new TypeError('AgentResult status 无效'), {code: 'INVALID_AGENT_RESULT'})
    const tests = Array.isArray(value.tests) ? value.tests.slice(0, 50).map(item => ({
        name: text(item?.name || item?.command, 300),
        status: ['passed', 'failed', 'skipped', 'not_run'].includes(item?.status) ? item.status : 'not_run',
        executed: item?.executed === true,
        evidence: text(item?.evidence, 1000),
    })) : []
    if (tests.some(item => item.status === 'passed' && !item.executed)) {
        throw Object.assign(new Error('Agent 未执行测试却声称通过'), {code: 'FALSE_TEST_CLAIM'})
    }
    const changedFiles = strings(value.changedFiles, 200, 1000)
    return {
        version: 1,
        taskId: text(value.taskId || identity.taskId, 240),
        stepId: text(value.stepId || identity.stepId, 240),
        agentRunId: text(value.agentRunId || identity.agentRunId, 240),
        role: text(value.role || identity.role, 80),
        status,
        summary: text(value.summary, 4000),
        changedFiles,
        writeRequest: normalizeWriteRequest(value.writeRequest, value.requestedFiles || []),
        tests,
        findings: Array.isArray(value.findings) ? value.findings.slice(0, 100).map(item => ({
            severity: ['critical', 'high', 'medium', 'low'].includes(item?.severity) ? item.severity : 'medium',
            blocking: item?.blocking === true,
            summary: text(item?.summary || item?.title, 1000),
            file: text(item?.file, 1000),
        })) : [],
        blockers: strings(value.blockers, 50, 1000),
        regressions: strings(value.regressions, 50, 1000),
        nextAction: text(value.nextAction, 1000),
    }
}
