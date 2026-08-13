import {isSyntheticCompactSummary} from './context-lifecycle.mjs'

function visibleUserText(raw) {
    let text = typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
            ? raw.map(block => block?.type === 'text' ? block.text : '').join(' ').trim()
            : ''
    const marker = '===== 用户消息 =====\n'
    if (text.includes(marker)) text = text.slice(text.lastIndexOf(marker) + marker.length).trim()
    return text
}

export function parseSessionHistory(content) {
    const messages = []
    for (const line of String(content || '').split('\n')) {
        if (!line.trim()) continue
        let entry
        try {
            entry = JSON.parse(line)
        } catch (error) {
            if (error instanceof SyntaxError) continue
            throw error
        }
        const time = entry.timestamp
        if (entry.type === 'user' && entry.message?.content) {
            if (isSyntheticCompactSummary(entry)) continue
            const text = visibleUserText(entry.message.content)
            if (text) messages.push({role: 'user', text, time})
            continue
        }
        if (entry.type !== 'assistant' || !entry.message?.content) continue
        const blocks = Array.isArray(entry.message.content) ? entry.message.content : [entry.message.content]
        const thinking = blocks.filter(block => block?.type === 'thinking' && block.thinking)
            .map(block => block.thinking).join('')
        const tools = blocks.filter(block => block?.type === 'tool_use' && block.name)
            .map(block => ({
                tool_name: block.name,
                tool_use_id: block.id || '',
                input: block.input && typeof block.input === 'object' ? block.input : {},
            }))
        if (thinking) messages.push({role: 'thinking', text: '思考内容', thinkingContent: thinking, time})
        for (const block of blocks) {
            if (block?.type === 'text' && block.text) {
                messages.push({
                    role: 'assistant',
                    text: block.text,
                    tools: tools.length ? tools : undefined,
                    time,
                })
            }
        }
    }
    return messages
}
