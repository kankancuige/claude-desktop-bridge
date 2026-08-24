const MAX_TITLE = 80
const MAX_SUMMARY = 4000
const MAX_REQUEST = 12000
const SOURCES = new Set(['desktop', 'wechat', 'feishu', 'dingtalk', 'workflow', 'scheduled'])

function normalize(value, max) {
    return String(value ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\t ]+/g, ' ')
        .split('\n').map(line => line.trim()).filter(Boolean).join('\n')
        .slice(0, max)
}

function removeCodeBlocks(value) {
    return String(value ?? '').replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '')
}

function meaningfulLines(value) {
    return normalize(removeCodeBlocks(value), MAX_REQUEST).split('\n').filter(Boolean)
}

function headingText(line) {
    return String(line || '').replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '').trim()
}

export function createTaskMetadata({taskText = '', content = '', source = 'desktop'} = {}) {
    const explicit = normalize(taskText, MAX_REQUEST)
    const cleanedContent = normalize(removeCodeBlocks(content), MAX_REQUEST)
    const contentLines = meaningfulLines(content)
    const title = headingText((explicit || contentLines[0] || '').split('\n')[0]).slice(0, MAX_TITLE) || '未命名任务'
    const requestText = (explicit || cleanedContent).slice(0, MAX_REQUEST)
    const summary = cleanedContent.slice(0, MAX_SUMMARY)
    const goal = (explicit || summary).slice(0, MAX_SUMMARY)
    return {
        title,
        summary,
        goal,
        requestText,
        source: SOURCES.has(String(source)) ? String(source) : String(source || 'desktop'),
    }
}
