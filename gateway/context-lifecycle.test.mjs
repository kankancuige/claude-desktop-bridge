import test from 'node:test'
import assert from 'node:assert/strict'
import {
    calculateAutoCompactWindow,
    compactBoundaryToEvent,
    isSyntheticCompactSummary,
    normalizeContextUsage,
    parseTokenCount,
    resolveContextWindow,
} from './context-lifecycle.mjs'

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
    assert.equal(isSyntheticCompactSummary({message: {content: [{type: 'text', text: 'normal user message'}]}}), false)
})
