import {isSyntheticCompactSummary} from '../context/context-lifecycle.mjs'
import {isInternalWorkflowResultText} from '../tasks/task-workflow-gate.mjs'
import {isAutoContinuationPrompt} from '../tasks/task-auto-continuation.mjs'

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

function attachmentMetadata(raw) {
    const text = Array.isArray(raw)
        ? raw.map(block => block?.type === 'text' ? block.text : '').join('\n')
        : typeof raw === 'string' ? raw : ''
    const attachments = []
    const seen = new Set()
    const add = (name, kind, path) => {
        const normalizedPath = String(path || '').trim()
        if (!normalizedPath || seen.has(normalizedPath)) return
        seen.add(normalizedPath)
        attachments.push({
            name: String(name || normalizedPath).trim(),
            size: 0,
            type: 'application/octet-stream',
            uploadedPath: normalizedPath,
            attachmentKind: String(kind || 'binary').trim(),
            contentType: 'application/octet-stream',
            status: 'sent',
        })
    }
    for (const match of text.matchAll(/^-\s+(.+?)\s+\|\s*类型:\s*(.+?)\s+\|\s*路径:\s*(.+)$/gm)) add(match[1], match[2], match[3])
    for (const match of text.matchAll(/^=====\s*图片:\s*(.+?)\s*\((.+?)\)\s*=====$/gm)) add(match[1], 'image', match[2])
    return attachments
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
            if (isInternalWorkflowResultText(text) || isAutoContinuationPrompt(text)) continue
            const attachments = attachmentMetadata(entry.message.content)
            if (text || attachments.length) messages.push({role: 'user', text, ...(attachments.length ? {attachments} : {}), time})
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
