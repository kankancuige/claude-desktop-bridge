const MAX_FACTS = 8
const MAX_SUMMARY = 400

function text(value, max = 12000) {
    return typeof value === 'string' ? value.replace(/[\0\r]/g, ' ').trim().slice(0, max) : ''
}

function redact(value) {
    return value
        .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
        .replace(/\b(?:sk|key|token)-[A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]')
        .replace(/((?:api[_-]?key|auth[_-]?token|access[_-]?token|password|secret)\s*[=:]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]')
        .replace(/https?:\/\/[^\s/@:]+:[^\s/@]+@/gi, 'https://[REDACTED]@')
}

function cleanSummary(value) {
    const summary = redact(text(value, MAX_SUMMARY))
        .replace(/^[\s>*#\-\d.)]+/, '')
        .replace(/[。！？!?；;]+$/, '')
        .replace(/\s+/g, ' ')
        .trim()
    if (!summary || summary.length < 3 || /\[REDACTED\]/i.test(summary)) return ''
    return summary.slice(0, MAX_SUMMARY)
}

function markerSummary(line) {
    const value = text(line, 2000)
    if (!value || /(?:不要|别|禁止|不需要).{0,12}(?:记住|记忆|记录|保存)/i.test(value)) return ''
    const match = value.match(/(?:请)?(?:记住|记忆|记录|保存|沉淀)(?:一下|下来)?\s*[：:,，]?\s*(.+)$/i)
        || value.match(/(?:项目约定|以后(?:都|请)|固定(?:使用|采用)|必须使用|不要使用)\s*[：:,，]?\s*(.+)$/i)
    return cleanSummary(match?.[1] || '')
}

/**
 * 只从用户明确表达的长期约定生成 candidate；普通回答和模型猜测不参与自动沉淀。
 */
export function extractAutomaticMemoryFacts({requestText, taskId, projectKey} = {}) {
    const task = text(taskId, 240)
    const project = text(projectKey, 240)
    if (!task || !project) return []
    const seen = new Set()
    const facts = []
    for (const line of text(requestText).split(/[\n。！？!?；;]/)) {
        const summary = markerSummary(line)
        if (!summary || seen.has(summary.toLowerCase())) continue
        seen.add(summary.toLowerCase())
        facts.push({
            summary,
            verified: true,
            evidence: [`request:${task}`],
            capture: 'automatic-explicit',
        })
        if (facts.length >= MAX_FACTS) break
    }
    return facts
}

export function extractAutomaticMemoryFactsFromSession({session, projectKey, encodeProjectName} = {}) {
    const workDir = text(session?.workDir, 1000)
    const key = text(projectKey, 240) || (workDir && typeof encodeProjectName === 'function' ? text(encodeProjectName(workDir), 240) : '')
    return extractAutomaticMemoryFacts({
        requestText: session?.taskRequestText || session?.taskState?.requestText || '',
        taskId: session?.taskCompletionTaskId || session?.coordinatorTaskId || '',
        projectKey: key,
    })
}
