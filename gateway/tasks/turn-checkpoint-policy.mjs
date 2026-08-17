/**
 * 决定当前回合是否需要记录文件状态。
 * 轻量纯问答没有代码副作用，跳过全项目扫描；无法确认任务类型时保守保留追踪。
 */
export function shouldCaptureTurnCheckpoint(decision) {
    return !(decision?.action === 'query' && decision?.contextProfile === 'light')
}
