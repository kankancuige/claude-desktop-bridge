/**
 * 自动 Memory 捕获适配器：把会话生命周期对象转换为纯捕获器和 Repository port 所需的输入。
 * 完成运行时只依赖 captureAutomaticMemory，不感知 Memory 文件、PostgreSQL 或项目编码规则。
 */
export function createMemoryAutoCaptureRuntime({getCandidateStore, extractFacts, encodeProjectName} = {}) {
    if (typeof getCandidateStore !== 'function' || typeof extractFacts !== 'function') {
        throw new TypeError('Memory auto capture dependencies are required')
    }
    return {
        async captureAutomaticMemory({session, sessionId} = {}) {
            const store = getCandidateStore()
            if (!store?.extractMemoryCandidates) return []
            const facts = extractFacts({session, projectKey: session?.projectKey, encodeProjectName})
            if (!facts.length) return []
            return store.extractMemoryCandidates({
                taskId: session?.taskCompletionTaskId || session?.coordinatorTaskId || sessionId || '',
                projectKey: session?.projectKey || (typeof encodeProjectName === 'function' ? encodeProjectName(session?.workDir || '') : ''),
                verifiedFacts: facts,
                scope: session?.taskScope || 'project',
            })
        },
    }
}
