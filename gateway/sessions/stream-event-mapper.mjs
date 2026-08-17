/**
 * 将 Claude Agent SDK 的流式事件转换为 Bridge 内部事件。
 * 工具参数通常通过 input_json_delta 分片发送，不能只依赖
 * content_block_start 中的空 input，否则界面无法显示实际文件和命令。
 */
export function mapStreamEvent(event) {
    if (!event || typeof event !== 'object') return null

    if (event.type === 'content_block_start') {
        const block = event.content_block || {}
        if (block.type === 'tool_use') {
            return {
                type: 'tool_use_start',
                index: event.index,
                tool_name: block.name,
                tool_use_id: block.id,
                input: block.input && typeof block.input === 'object' ? block.input : {},
            }
        }
        if (block.type === 'thinking') {
            return {type: 'thinking_start', index: event.index, thinking: block.thinking || ''}
        }
        return {type: 'content_block_start', index: event.index}
    }

    if (event.type === 'content_block_delta') {
        const delta = event.delta || {}
        if (delta.type === 'input_json_delta') {
            return {
                type: 'tool_input_delta',
                index: event.index,
                partial_json: typeof delta.partial_json === 'string' ? delta.partial_json : '',
            }
        }
        if (delta.type === 'text_delta') return {type: 'text_delta', text: delta.text}
        if (delta.type === 'thinking_delta') {
            return {type: 'thinking_delta', index: event.index, thinking: delta.thinking || ''}
        }
        return null
    }

    if (event.type === 'content_block_stop') {
        // 工具和思考块都使用 index 结束；前端据此关闭对应的运行步骤。
        return {
            type: 'content_block_stop',
            index: event.index,
        }
    }

    if (event.type === 'message_start') {
        return {
            type: 'message_start',
            model: event.message?.model,
            usage: event.message?.usage,
        }
    }

    return null
}
