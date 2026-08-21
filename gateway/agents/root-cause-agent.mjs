export function buildRootCauseAgentInput(input = {}) {
    return {
        taskId: String(input.taskId || ''),
        stepId: String(input.stepId || ''),
        role: 'root-cause-agent',
        goal: '基于证据建立完整故障因果链，不直接修改代码',
        evidence: {
            trigger: input.trigger || null,
            transformation: input.transformation || null,
            stateChange: input.stateChange || null,
            persistenceOrMessaging: input.persistenceOrMessaging || null,
            downstream: input.downstream || null,
            lifecycle: input.lifecycle || null,
            concurrency: input.concurrency || null,
            architectureBoundary: input.architectureBoundary || null,
        },
    }
}
