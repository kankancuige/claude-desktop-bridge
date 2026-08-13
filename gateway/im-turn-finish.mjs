export function turnFallbackText(reason) {
    switch (reason) {
        case 'result':
        case 'task_completed':
            return '处理完成，无文本回复'
        case 'task_failed':
            return '任务未完成，请在当前会话查看错误并重试'
        case 'task_review_paused':
            return '最终审查已暂停，请在当前会话继续处理'
        case 'stopped':
            return '会话已停止'
        case 'duplicate':
            return '该消息已接收，请勿重复发送'
        case 'queue_full':
            return '当前会话待处理消息已达上限，请稍后重试'
        case 'invalid_input':
            return '消息为空、格式无效或内容过长，请缩短后重试'
        default:
            return '处理超时或连接中断，请稍后重试'
    }
}
