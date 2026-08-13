import {closeSync, openSync, readSync} from 'node:fs'

const DEFAULT_MAX_BYTES = 256 * 1024
const DEFAULT_MAX_RECORDS = 64

function messageText(record) {
    const content = record?.message?.content
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content.map(item => {
        if (typeof item === 'string') return item
        if (typeof item?.text === 'string') return item.text
        if (typeof item?.content === 'string') return item.content
        return ''
    }).join('\n')
}

/**
 * 某些 Claude Code 版本会把 Agent transcript 写成顶层 jsonl，isSidechain 也会是 false。
 * 这些内部提示带有机器协议，不能仅靠 sidechain 字段过滤；普通用户的“审查项目”请求不匹配。
 */
function isInternalAgentPrompt(text) {
    const value = String(text || '')
    if (/^对抗性验证此发现是否真实存在。不存在则返回\s*refuted:true:/u.test(value)) return true
    if (/\[IMPORTANT\]\s*You MUST output ONLY valid JSON matching:/i.test(value)) return true
    return /^审查\s+.+下的代码:\s*\r?\n(?:安全问题|潜在\s*bug|性能问题):/u.test(value)
}

export function classifyTranscriptLines(lines, maxRecords = DEFAULT_MAX_RECORDS) {
    let parsedRecords = 0
    let sawAgentMarker = false
    let firstUserPromptSeen = false
    let firstUserPromptIsInternalAgent = false
    let sawMainMarker = false

    for (const line of lines) {
        if (!line?.trim()) continue
        let record
        try {
            record = JSON.parse(line)
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error
            continue
        }

        parsedRecords++
        // 主会话可能包含 agentId，因为它可以调用 Agent 工具；先收集标记，最后再统一判定。
        if (record?.isSidechain === false) sawMainMarker = true
        if (record?.isSidechain === true) sawAgentMarker = true
        if (record?.type === 'user' && !firstUserPromptSeen) {
            firstUserPromptSeen = true
            firstUserPromptIsInternalAgent = isInternalAgentPrompt(messageText(record))
        }
        if (parsedRecords >= maxRecords) break
    }

    if (sawAgentMarker || firstUserPromptIsInternalAgent) return 'agent'
    if (sawMainMarker) return 'main'
    return 'unknown'
}

export function classifyTranscriptFile(filePath, maxBytes = DEFAULT_MAX_BYTES) {
    let fd
    try {
        fd = openSync(filePath, 'r')
        const buffer = Buffer.allocUnsafe(maxBytes)
        const bytesRead = readSync(fd, buffer, 0, maxBytes, 0)
        return classifyTranscriptLines(buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/))
    } catch {
        return 'unknown'
    } finally {
        if (fd !== undefined) closeSync(fd)
    }
}
