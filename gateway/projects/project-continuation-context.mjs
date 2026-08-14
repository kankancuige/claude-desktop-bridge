import {classifyTranscriptLines} from './transcript-classifier.mjs'
import {parseSessionHistory} from '../sessions/session-history.mjs'

const DEFAULT_MAX_CHARS = 6000
const REFERENTIAL_PATTERNS = [
    /^(?:请)?(?:继续|接着|接着做|继续做|继续修改|继续优化|加上)(?:吧|一下)?[。！!]?$/u,
    /^(?:请)?继续完成(?:上一个|上次|之前的?)任务(?:吧|一下)?[。！!]?$/u,
    /^按(?:刚才|之前|上次)的?(?:方案|计划|修改)?(?:做|修改|实现|继续)?(?:吧|一下)?[。！!]?$/u,
]

export function isReferentialContinuation(value) {
    const text = String(value || '').trim()
    return !!text && text.length <= 40 && REFERENTIAL_PATTERNS.some(pattern => pattern.test(text))
}

function isClarification(text) {
    return /请(?:说明|补充|提供|明确).*(?:内容|需求|文件|功能)|不知道.*(?:什么|哪)|无法判断/u.test(text)
}

function extractInheritedTask(content) {
    const tasks = []
    for (const line of String(content || '').split(/\r?\n/)) {
        if (!line.trim()) continue
        try {
            const entry = JSON.parse(line)
            if (entry?.type !== 'user') continue
            const raw = typeof entry.message?.content === 'string'
                ? entry.message.content
                : Array.isArray(entry.message?.content)
                    ? entry.message.content.filter(block => block?.type === 'text').map(block => block.text || '').join('\n')
                    : ''
            if (!raw.includes('<bridge-project-continuation')) continue
            for (const match of raw.matchAll(/^用户任务:\s*(.+)$/gmu)) {
                if (match[1]?.trim()) tasks.push(match[1].trim())
            }
        } catch {
            // 正在写入的半行不影响其他完整记录。
        }
    }
    return tasks.at(-1) || ''
}

function parseCandidate(candidate) {
    const content = String(candidate?.content || '')
    const kind = classifyTranscriptLines(content.split(/\r?\n/))
    if (kind === 'agent') return null
    const messages = parseSessionHistory(content)
        .filter(message => (message.role === 'user' || message.role === 'assistant') && message.text?.trim())
        .map(message => ({role: message.role, text: message.text.trim()}))
    const inheritedTask = extractInheritedTask(content)
    const visibleTask = [...messages].reverse().find(message =>
        message.role === 'user'
        && message.text.length >= 8
        && !isReferentialContinuation(message.text))?.text || ''
    const primaryTask = visibleTask || inheritedTask
    const hasSubstantiveRequest = Boolean(primaryTask)
    const hasUsefulResponse = messages.some(message =>
        message.role === 'assistant'
        && message.text.length >= 8
        && !isClarification(message.text))
    if (!hasSubstantiveRequest || !hasUsefulResponse) return null
    return {...candidate, messages, primaryTask}
}

function boundedContext(candidate, maxChars) {
    const selected = candidate.messages.slice(-4)
    const lines = [
        '以下是同一项目最近一个有效会话的只读接力上下文。只用于理解当前省略指代；不得声称已经完成未验证的工作。',
        `来源会话: ${candidate.id}`,
        `当前任务: ${candidate.primaryTask}`,
    ]
    for (const message of selected) {
        lines.push(`${message.role === 'user' ? '用户任务' : 'AI结果'}: ${message.text}`)
    }
    const text = lines.join('\n')
    return text.length <= maxChars ? text : text.slice(0, maxChars)
}

/** 仅为空白会话的引用性首句选择最近有效主 transcript。 */
export function buildProjectContinuationContext({
    prompt,
    hasUserTurns = false,
    currentSessionId = null,
    transcripts = [],
    maxChars = DEFAULT_MAX_CHARS,
} = {}) {
    if (hasUserTurns || !isReferentialContinuation(prompt)) return null
    const candidates = transcripts
        .filter(candidate => candidate?.id && candidate.id !== currentSessionId)
        .map(parseCandidate)
        .filter(Boolean)
        .sort((a, b) => Number(b.mtime || 0) - Number(a.mtime || 0))
    const source = candidates[0]
    if (!source) return null
    return {
        sourceSessionId: source.id,
        text: boundedContext(source, Math.max(256, Math.min(DEFAULT_MAX_CHARS, Number(maxChars) || DEFAULT_MAX_CHARS))),
    }
}

export function composeContinuationPrompt(prompt, context) {
    if (!context?.text) return String(prompt || '')
    return [
        `<bridge-project-continuation source-session-id="${context.sourceSessionId}">`,
        context.text,
        '</bridge-project-continuation>',
        '',
        '===== 用户消息 =====',
        String(prompt || ''),
    ].join('\n')
}
