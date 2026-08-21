/**
 * 会话恢复必须延续已落盘的实际模型，避免冷启动的默认下拉值静默改写历史上下文分区。
 */
export function resolveResumeModel({createMode, requestedModel, persistedModel} = {}) {
    const requested = typeof requestedModel === 'string' ? requestedModel.trim() : ''
    const persisted = typeof persistedModel === 'string' ? persistedModel.trim() : ''
    return createMode === 'resume' && persisted ? persisted : requested
}
