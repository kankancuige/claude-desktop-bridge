import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {
    calculateAutoCompactWindow,
    compactBoundaryToEvent,
    isSyntheticCompactSummary,
    normalizeContextUsage,
    parseTokenCount,
    resolveContextWindow,
    contextUsageEvent,
} from './context-lifecycle.mjs'

const gatewaySource = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')

test('parseTokenCount supports K/M suffixes and rejects invalid values', () => {
    assert.equal(parseTokenCount('256K'), 256000)
    assert.equal(parseTokenCount('1M'), 1000000)
    assert.equal(parseTokenCount('258,572'), 258572)
    assert.equal(parseTokenCount('unknown'), null)
})

test('SDK actual context window wins over provider metadata and safety cap only lowers it', () => {
    const resolved = resolveContextWindow({
        sdkRawMaxTokens: 256000,
        modelUsageContextWindow: 1000000,
        providerContextWindow: '1M',
        configuredSafetyCap: 900000,
    })
    assert.deepEqual(resolved, {actualMaxTokens: 256000, effectiveMaxTokens: 256000, source: 'sdk'})
})

test('unknown model does not pretend to have a 1M context window', () => {
    assert.deepEqual(resolveContextWindow({}), {actualMaxTokens: null, effectiveMaxTokens: null, source: 'unknown'})
})

test('auto compact window is 90 percent of the real or lower safety-capped window', () => {
    assert.equal(calculateAutoCompactWindow(256000), 230400)
    assert.equal(calculateAutoCompactWindow(256000, 200000), 180000)
    assert.equal(calculateAutoCompactWindow(null, 1000000), null)
})

test('SDK context usage is normalized without treating one-turn usage as context', () => {
    assert.deepEqual(normalizeContextUsage({
        totalTokens: 258572,
        maxTokens: 256000,
        rawMaxTokens: 256000,
        percentage: 100,
        categories: [{name: 'messages', tokens: 258572}],
    }), {
        totalTokens: 258572,
        maxTokens: 256000,
        rawMaxTokens: 256000,
        percentage: 100,
        categories: [{name: 'messages', tokens: 258572}],
    })
})

test('context usage event carries the effective auto compact threshold', () => {
    const event = contextUsageEvent({
        totalTokens: 180000,
        maxTokens: 256000,
        rawMaxTokens: 256000,
        percentage: 70,
    }, {autoCompactThreshold: 230400, reason: 'running'})
    assert.equal(event.autoCompactThreshold, 230400)
    assert.equal(event.reason, 'running')
})

test('Gateway 上下文采样有超时且不会永久占用 in-flight 状态', () => {
    const start = gatewaySource.indexOf('async function refreshContextUsage')
    const end = gatewaySource.indexOf('function maybeRefreshContextUsage', start)
    assert.ok(start >= 0 && end > start)
    const source = gatewaySource.slice(start, end)
    assert.match(source, /withTimeout\(Promise\.resolve\(session\.query\.getContextUsage\(\)\), 5_000\)/)
    assert.match(source, /finally \{\s*session\._contextUsageInFlight = null/)
})

test('compact boundary becomes a compact UI event', () => {
    assert.deepEqual(compactBoundaryToEvent({
        type: 'system',
        subtype: 'compact_boundary',
        compact_metadata: {trigger: 'auto', pre_tokens: 258731, post_tokens: 12160, duration_ms: 202263},
    }), {
        type: 'context_compacted',
        trigger: 'auto',
        preTokens: 258731,
        postTokens: 12160,
        durationMs: 202263,
    })
})

test('synthetic compact summaries are hidden from normal transcript bubbles', () => {
    assert.equal(isSyntheticCompactSummary({message: {isCompactSummary: true}}), true)
    assert.equal(isSyntheticCompactSummary({isCompactSummary: true, message: {content: 'internal'}}), true)
    assert.equal(isSyntheticCompactSummary({message: {content: [{type: 'text', text: 'This session is being continued...'}]}}), true)
    assert.equal(isSyntheticCompactSummary({message: {content: 'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion.'}}), true)
    assert.equal(isSyntheticCompactSummary({message: {content: 'The conversation has been compacted for continuation.'}}), true)
    assert.equal(isSyntheticCompactSummary({message: {content: [{type: 'text', text: 'normal user message'}]}}), false)
})

test('Gateway 不再向界面广播压缩摘要正文', () => {
    assert.doesNotMatch(gatewaySource, /context_compaction_summary/)
    assert.doesNotMatch(gatewaySource, /compact_summary/)
})
