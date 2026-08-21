const TERMINAL_EVENTS = new Set([
    'task_completed', 'task_failed', 'task_review_paused', 'task_verification_inconclusive',
    'generation_stopped', 'stream_error', 'error',
])

function boundedText(value, max = 120) {
    if (typeof value !== 'string') return ''
    const normalized = value.replace(/\s+/g, ' ').trim()
        .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [已脱敏]')
        .replace(/\b(?:sk|key|token)-[A-Za-z0-9._-]{8,}\b/gi, '[已脱敏]')
        .replace(/((?:api[_-]?key|access[_-]?token|auth(?:orization)?)\s*[:=]\s*)[^\s,;]+/gi, '$1[已脱敏]')
    return normalized.length > max ? `${normalized.slice(0, Math.max(0, max - 1))}…` : normalized
}

function toolPhase(event) {
    const name = boundedText(event?.tool_name || event?.toolName, 50) || '工具'
    const input = event?.input && typeof event.input === 'object' ? event.input : {}
    if (['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'].includes(name)) {
        return {key: 'explore', title: '正在定位和读取相关内容', detail: name}
    }
    if (['Edit', 'Write', 'NotebookEdit'].includes(name)) {
        return {key: 'modify', title: '正在修改项目文件', detail: boundedText(input.file_path || input.path || name)}
    }
    const command = boundedText(input.command, 180).toLowerCase()
    if (name === 'Bash' && /\b(test|build|compile|check|lint|pytest|mvn|gradle|pnpm|npm|dotnet)\b/.test(command)) {
        return {key: 'verify', title: '正在执行构建或测试', detail: name}
    }
    return {key: 'tool', title: '正在执行项目操作', detail: name}
}

export function classifyImProgressEvent(event = {}) {
    const type = String(event?.type || '')
    if (TERMINAL_EVENTS.has(type)) return {terminal: true}
    if (type === 'task_coordinator_event') {
        const phaseLabels = {
            prime: '正在建立项目上下文', plan: '正在制定执行计划', implement: '正在实现代码变更',
            validate: '正在验证本次修改', review: '正在定向审查', report: '正在整理最终报告',
        }
        const phase = boundedText(event.phase, 40)
        const evidence = boundedText(event.verification?.evidenceLevel, 20)
        return {
            key: `coordinator:${phase || event.status}:${event.event}`,
            title: phaseLabels[phase] || boundedText(event.detail) || '任务协调器正在处理',
            detail: [boundedText(event.role, 60), evidence ? `证据 ${evidence}` : ''].filter(Boolean).join(' · '),
        }
    }
    if (type === 'task_started') return {key: 'starting', title: '任务已开始处理', detail: ''}
    if (type === 'task_auto_continuing') {
        const attempt = Math.max(1, Math.trunc(Number(event.attempt) || 1))
        const maxAttempts = Math.max(attempt, Math.trunc(Number(event.maxAttempts) || attempt))
        return {key: `auto-continue:${attempt}`, title: '已达到单段轮数上限，正在自动续跑', detail: `第 ${attempt}/${maxAttempts} 次`}
    }
    if (type === 'task_decision') return {key: 'planning', title: '正在规划执行方案', detail: boundedText(event.modelTier || event.model)}
    if (type === 'thinking_start' || type === 'thinking_delta') return {key: 'thinking', title: '正在分析任务', detail: ''}
    if (type === 'tool_use_start' || type === 'tool_progress') return toolPhase(event)
    if (['subagent_spawning', 'subagent_start', 'subagent_progress', 'agent_start', 'agent_progress', 'workflow_agent_started'].includes(type)) {
        return {key: 'agent', title: 'Agent 正在处理子任务', detail: boundedText(event.agentType || event.agentName || event.description)}
    }
    if (['workflow_started', 'workflow_resumed'].includes(type)) {
        return {key: 'workflow', title: '工作流正在执行', detail: boundedText(event.name)}
    }
    if (type === 'workflow_phase' || type === 'workflow_log') {
        const phase = boundedText(event.phase || event.currentPhase || event.message)
        return {key: `workflow:${phase || 'running'}`, title: phase ? `正在执行：${phase}` : '工作流正在执行', detail: ''}
    }
    if (type === 'context_compacting') {
        return {key: 'compacting', title: '正在压缩并整理上下文', detail: ''}
    }
    if (type === 'task_reviewing' || type === 'primary_completed') {
        return {key: 'reviewing', title: '正在进行定向审查', detail: boundedText(event.detail)}
    }
    if (type === 'task_fixing' || type === 'task_changes_required') {
        return {key: 'fixing', title: '正在修复审查发现的问题', detail: boundedText(event.detail)}
    }
    if (type === 'assistant_message' || type === 'text_delta') {
        return {key: 'responding', title: '正在整理最终结果', detail: ''}
    }
    return null
}

function formatElapsed(milliseconds) {
    const seconds = Math.max(0, Math.round(milliseconds / 1000))
    if (seconds < 60) return `${seconds} 秒`
    const minutes = Math.floor(seconds / 60)
    const remain = seconds % 60
    return remain ? `${minutes} 分 ${remain} 秒` : `${minutes} 分`
}

/**
 * 统一决定 IM 长任务进度发送时机。调用方只提供事件和实际发送函数。
 */
export function createImProgressReporter({
    send,
    now = () => Date.now(),
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timer => clearTimeout(timer),
    firstDelayMs = 30_000,
    intervalMs = 60_000,
    maxMessages = 4,
    onError = () => {},
} = {}) {
    if (typeof send !== 'function') throw new TypeError('IM progress reporter 需要 send 函数')
    const state = {
        startedAt: 0,
        lastSentAt: 0,
        lastSentPhase: '',
        currentPhase: null,
        sent: 0,
        timer: null,
        finished: false,
    }

    const clearScheduled = () => {
        if (state.timer === null) return
        clearTimer(state.timer)
        state.timer = null
    }

    const schedule = delay => {
        clearScheduled()
        if (state.finished || state.sent >= maxMessages || !state.currentPhase) return
        state.timer = setTimer(() => {
            state.timer = null
            maybeSend()
        }, Math.max(0, delay))
        state.timer?.unref?.()
    }

    const maybeSend = () => {
        if (state.finished || state.sent >= maxMessages || !state.startedAt || !state.currentPhase) return
        const timestamp = now()
        const firstDueAt = state.startedAt + firstDelayMs
        if (state.sent === 0 && timestamp < firstDueAt) {
            schedule(firstDueAt - timestamp)
            return
        }
        if (state.sent > 0) {
            if (state.currentPhase.key === state.lastSentPhase) return
            const nextDueAt = state.lastSentAt + intervalMs
            if (timestamp < nextDueAt) {
                schedule(nextDueAt - timestamp)
                return
            }
        }

        const phase = state.currentPhase
        const elapsed = formatElapsed(timestamp - state.startedAt)
        const text = [`任务仍在执行 · 已用时 ${elapsed}`, `当前阶段：${phase.title}`]
        if (phase.detail) text.push(`进展：${phase.detail}`)
        state.sent++
        state.lastSentAt = timestamp
        state.lastSentPhase = phase.key
        try {
            Promise.resolve(send(text.join('\n'), {
                phase: phase.key,
                elapsedMs: timestamp - state.startedAt,
                sequence: state.sent,
            })).catch(error => onError(error))
        } catch (error) {
            onError(error)
        }
    }

    const finish = () => {
        if (state.finished) return
        state.finished = true
        clearScheduled()
    }

    return {
        observe(event) {
            if (state.finished) return
            const phase = classifyImProgressEvent(event)
            if (!phase) return
            if (phase.terminal) {
                finish()
                return
            }
            const timestamp = now()
            if (!state.startedAt || event?.type === 'task_started') state.startedAt = Number(event?.startedAt) || timestamp
            state.currentPhase = phase
            maybeSend()
        },
        finish,
        snapshot() {
            return {
                startedAt: state.startedAt,
                lastSentAt: state.lastSentAt,
                lastSentPhase: state.lastSentPhase,
                currentPhase: state.currentPhase ? {...state.currentPhase} : null,
                sent: state.sent,
                scheduled: state.timer !== null,
                finished: state.finished,
            }
        },
    }
}
