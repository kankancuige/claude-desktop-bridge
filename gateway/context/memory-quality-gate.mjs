function finite(value, fallback = 0) {
    const result = Number(value)
    return Number.isFinite(result) ? result : fallback
}

function sourceKey(row) {
    if (typeof row === 'string') return row
    return String(row?.sourceKey || row?.sourcePath || row?.key || row?.id || '').trim()
}

function resultKeys(value) {
    const rows = Array.isArray(value) ? value : []
    return rows.map(sourceKey).filter(Boolean)
}

function metrics(search, cases) {
    let expectedTotal = 0
    let expectedHits = 0
    let returnedTotal = 0
    let relevantReturned = 0
    const perCase = []
    for (const item of Array.isArray(cases) ? cases : []) {
        const expected = new Set((Array.isArray(item?.expectedSourceKeys) ? item.expectedSourceKeys : []).map(sourceKey).filter(Boolean))
        const returned = resultKeys(search?.(item?.query, item) || item?.results)
        const hits = returned.filter(key => expected.has(key))
        expectedTotal += expected.size
        expectedHits += new Set(hits).size
        returnedTotal += returned.length
        relevantReturned += new Set(hits).size
        perCase.push({query: String(item?.query || ''), expected: [...expected], returned, hits: [...new Set(hits)]})
    }
    return {
        recall: expectedTotal ? expectedHits / expectedTotal : 0,
        precision: returnedTotal ? relevantReturned / returnedTotal : 0,
        expectedTotal, expectedHits, returnedTotal, relevantReturned, perCase,
    }
}

export function evaluateMemoryQuality({keywordSearch, semanticSearch, cases = [], minRecall = 0.8, minPrecision = 0.6, maxRegression = 0} = {}) {
    if (typeof keywordSearch !== 'function' || typeof semanticSearch !== 'function') {
        return {passed: false, baseline: null, candidate: null, regressions: [], reasons: ['评测搜索函数未配置']}
    }
    const baseline = metrics(keywordSearch, cases)
    const candidate = metrics(semanticSearch, cases)
    const regressions = baseline.perCase
        .filter((item, index) => item.hits.length > 0 && candidate.perCase[index]?.hits?.length === 0)
        .map(item => item.query)
    const reasons = []
    if (candidate.recall < finite(minRecall, 0.8)) reasons.push('语义召回 recall 未达到阈值')
    if (candidate.precision < finite(minPrecision, 0.6)) reasons.push('语义召回 precision 未达到阈值')
    if (regressions.length > Math.max(0, Number(maxRegression) || 0)) reasons.push('语义召回导致关键词基线命中回归')
    return {passed: reasons.length === 0, baseline, candidate, regressions, reasons}
}

export function enableMemorySemanticMode({projectKey, quality, vectorHealth, embeddingModel, dimensions, projectSetting = null} = {}) {
    const project = String(projectKey || '').trim()
    const model = String(embeddingModel || '').trim()
    const dimensionCount = Number(dimensions)
    const settingEnabled = projectSetting === true || projectSetting?.enabled === true || projectSetting?.semanticMemoryEnabled === true
    let reason = null
    if (!project) reason = 'project_key_missing'
    else if (!settingEnabled) reason = 'project_not_explicitly_enabled'
    else if (!quality?.passed) reason = 'quality_gate_failed'
    else if (!vectorHealth?.healthy || vectorHealth?.enabled === false) reason = 'vector_health_failed'
    else if (!model) reason = 'embedding_model_missing'
    else if (!Number.isInteger(dimensionCount) || dimensionCount < 1) reason = 'embedding_dimensions_invalid'
    if (reason) return {enabled: false, reason, version: null}
    return {enabled: true, reason: null, version: `${model}:${dimensionCount}`}
}
