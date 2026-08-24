const DEFAULT_MAX_INPUT_TOKENS = 8_000
const MAX_TEXT_BYTES = 32 * 1024

function clean(value, max = 1200) {
    return typeof value === 'string' ? value.replace(/[\0\r\n]+/g, ' ').trim().slice(0, max) : ''
}

function estimateTokens(text) {
    return Math.ceil(Buffer.byteLength(String(text || ''), 'utf8') / 4)
}

function boundedText(text, maxBytes) {
    const source = String(text || '')
    if (Buffer.byteLength(source, 'utf8') <= maxBytes) return source
    let result = ''
    let used = 0
    for (const character of source) {
        const size = Buffer.byteLength(character, 'utf8')
        if (used + size > maxBytes) break
        result += character
        used += size
    }
    return result
}

function normalizeMemoryCandidates(value) {
    return (Array.isArray(value) ? value : []).map((item, index) => ({
        sourceKey: clean(item?.sourceKey || item?.sourcePath || item?.id || `memory-${index}`, 180),
        title: clean(item?.title || item?.sourceKey || item?.sourcePath || 'Memory', 160),
        abstract: clean(item?.abstract || item?.summary || item?.title, 360),
        overview: clean(item?.overview || item?.summary || item?.abstract || item?.title, 1000),
        body: typeof item?.body === 'string' ? item.body : '',
        score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null,
        verifiedAt: Number.isFinite(Number(item?.verifiedAt || item?.lastVerifiedAt)) ? Number(item.verifiedAt || item.lastVerifiedAt) : null,
    })).filter(item => item.sourceKey)
}

function memoryTextBodies(value) {
    const source = typeof value === 'string' ? value : ''
    const result = new Map()
    for (const block of source.split(/\n\s*\n/)) {
        const match = block.match(/来源:\s*([^\r\n]+)/)
        if (match?.[1]) result.set(match[1].trim(), block.trim())
    }
    return result
}

function section(name, value) {
    const text = clean(value, MAX_TEXT_BYTES)
    return text ? `[${name}]\n${text}` : ''
}

function takeWithinBudget(parts, maxTokens) {
    const selected = []
    let used = 0
    for (const part of parts) {
        const tokens = estimateTokens(part.text)
        if (used + tokens > maxTokens) continue
        selected.push({...part, tokens})
        used += tokens
    }
    return {selected, used}
}

export function createContextPlanner({logger = null} = {}) {
    function planContext({profile = 'full', task = {}, projectSummary = null, memoryCandidates = [], memoryText = '', previousSummary = '', references = [], budget = {}, includeDetails = true} = {}) {
        const normalizedProfile = profile === 'light' || profile === 'focused' ? profile : 'full'
        const maxInputTokens = Math.max(256, Math.min(100_000, Number(budget.maxInputTokens) || DEFAULT_MAX_INPUT_TOKENS))
        const bodyByReference = memoryTextBodies(memoryText)
        const requestedReferences = new Set((Array.isArray(references) ? references : []).map(value => String(value || '').trim()).filter(Boolean))
        const memories = normalizeMemoryCandidates(memoryCandidates).map(item => ({
            ...item,
            body: item.body || bodyByReference.get(item.sourceKey) || '',
        }))
        const l0Parts = [
            clean(task.goal || task.prompt || task.text, 800) && `目标：${clean(task.goal || task.prompt || task.text, 800)}`,
            clean(task.currentStep || task.phase, 240) && `当前步骤：${clean(task.currentStep || task.phase, 240)}`,
            clean(task.status, 120) && `任务状态：${clean(task.status, 120)}`,
            memories.length ? `相关 Memory：${memories.slice(0, 5).map(item => item.title).join('、')}` : '',
        ].filter(Boolean).join('\n')
        const l1Parts = [
            typeof projectSummary === 'string' ? projectSummary : projectSummary?.overview || projectSummary?.summary || '',
            previousSummary,
            memories.map(item => `${item.title}: ${item.overview}`).join('\n'),
        ].map(value => clean(value, 6_000)).filter(Boolean)
        const l2Parts = memories.filter(item => item.body && requestedReferences.has(item.sourceKey)).map(item => `${item.sourceKey}\n${item.title}\n${item.body}`)
        const l0Text = section('L0 摘要', l0Parts)
        const l1Text = section('L1 概览', l1Parts.join('\n'))
        const l2Text = section('L2 详情', l2Parts.join('\n\n'))
        const candidates = [
            {layer: 'l0', text: l0Text, reason: 'always_include'},
            ...(normalizedProfile !== 'light' ? [{layer: 'l1', text: l1Text, reason: 'profile_allows_overview'}] : []),
            ...(normalizedProfile === 'full' && includeDetails && requestedReferences.size ? [{layer: 'l2', text: l2Text, reason: 'explicit_references'}] : []),
        ].filter(item => item.text)
        const {selected, used} = takeWithinBudget(candidates, maxInputTokens)
        const selectedLayers = new Set(selected.map(item => item.layer))
        const omitted = candidates.filter(item => !selectedLayers.has(item.layer)).map(item => ({layer: item.layer, reason: 'input_budget'}))
        if (normalizedProfile === 'full' && includeDetails && memories.some(item => item.body) && !requestedReferences.size) omitted.push({layer: 'l2', reason: 'reference_not_requested'})
        const contextText = selected.map(item => item.text).join('\n\n')
        const plan = {
            profile: normalizedProfile,
            layers: {
                l0: {selected: selectedLayers.has('l0'), text: selected.find(item => item.layer === 'l0')?.text || ''},
                l1: {selected: selectedLayers.has('l1'), text: selected.find(item => item.layer === 'l1')?.text || ''},
                l2: {selected: selectedLayers.has('l2'), text: selected.find(item => item.layer === 'l2')?.text || ''},
            },
            references: memories.map(item => ({sourceKey: item.sourceKey, title: item.title, score: item.score, verifiedAt: item.verifiedAt})),
            estimatedInputTokens: used,
            maxInputTokens,
            omitted,
            contextText: boundedText(contextText, Math.min(MAX_TEXT_BYTES, maxInputTokens * 4)),
            reason: omitted.length ? 'budget_applied' : 'planned',
        }
        logger?.debug?.({profile: normalizedProfile, estimatedInputTokens: plan.estimatedInputTokens, omitted: plan.omitted.length}, 'Context Planner 已生成分层计划')
        return plan
    }

    function materializeContextLayer({plan, layer = 'l0', reference = null} = {}) {
        const normalizedLayer = layer === 'l1' || layer === 'l2' ? layer : 'l0'
        if (!plan?.layers?.[normalizedLayer]?.selected) return {text: '', layer: normalizedLayer, selected: false, reason: 'layer_omitted'}
        const text = plan.layers[normalizedLayer].text
        if (!reference) return {text, layer: normalizedLayer, selected: true, reason: 'selected'}
        const needle = String(reference).trim()
        if (!needle) return {text, layer: normalizedLayer, selected: true, reason: 'selected'}
        const blocks = text.split(/\n\s*\n/)
        const matched = blocks.filter(block => block.toLowerCase().includes(needle.toLowerCase()))
        if (!matched.length) return {text: '', layer: normalizedLayer, selected: false, reason: 'reference_not_found'}
        return {text: matched.join('\n\n'), layer: normalizedLayer, selected: true, reason: 'reference_selected'}
    }

    function recordContextUse({taskId = '', reference = '', layer = 'l0', selected = false, bytes = 0, reason = ''} = {}) {
        return {
            type: 'context/use',
            taskId: clean(taskId, 240) || null,
            reference: clean(reference, 240) || null,
            layer: layer === 'l1' || layer === 'l2' ? layer : 'l0',
            selected: selected === true,
            bytes: Math.max(0, Math.trunc(Number(bytes) || 0)),
            reason: clean(reason, 120) || null,
            at: Date.now(),
        }
    }

    return {planContext, materializeContextLayer, recordContextUse}
}

export const {planContext, materializeContextLayer, recordContextUse} = createContextPlanner()
