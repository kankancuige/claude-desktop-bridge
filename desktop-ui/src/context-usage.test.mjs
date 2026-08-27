import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'

const source = readFileSync(new URL('./context-usage.ts', import.meta.url), 'utf8')
const compiled = await transform(source, {loader: 'ts', format: 'esm', target: 'es2022'})
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
const {normalizeContextUiState, contextPercentFromTokens, formatCompactSummary, isSyntheticCompactUiMessage} = await import(moduleUrl)

test('已知上下文窗口即使当前 token 为 0 也返回 0%', () => {
    assert.equal(contextPercentFromTokens(0, '200K'), 0)
    assert.equal(contextPercentFromTokens(120000, 200000), 60)
    assert.equal(contextPercentFromTokens(120000, null), null)
})

test('上下文超过最大窗口时占比封顶 100%', () => {
    assert.equal(contextPercentFromTokens(220000, 200000), 100)
})

test('context UI uses SDK percentage and actual max tokens', () => {
    assert.deepEqual(normalizeContextUiState({
        totalTokens: 230000,
        maxTokens: 256000,
        rawMaxTokens: 256000,
        percentage: 89.843,
    }), {
        totalTokens: 230000,
        maxTokens: 256000,
        rawMaxTokens: 256000,
        percentage: 90,
        state: 'warning',
    })
})

test('unknown context remains unknown instead of showing a fake percentage', () => {
    assert.deepEqual(normalizeContextUiState({totalTokens: 1000}), {
        totalTokens: 1000,
        maxTokens: null,
        rawMaxTokens: null,
        percentage: null,
        state: 'unknown',
    })
})

test('configured safety cap can only lower the actual SDK context window', () => {
    assert.deepEqual(normalizeContextUiState({
        totalTokens: 180000,
        maxTokens: 256000,
        rawMaxTokens: 256000,
        percentage: 70,
        configuredSafetyCap: 200000,
    }), {
        totalTokens: 180000,
        maxTokens: 200000,
        rawMaxTokens: 256000,
        percentage: 90,
        state: 'warning',
    })
})

test('context usage accepts SDK wire aliases when a relay returns snake_case fields', () => {
    assert.deepEqual(normalizeContextUiState({
        total_tokens: 120000,
        max_tokens: 200000,
        raw_max_tokens: 256000,
        percentage: 60,
    }), {
        totalTokens: 120000,
        maxTokens: 200000,
        rawMaxTokens: 256000,
        percentage: 60,
        state: 'normal',
    })
})

test('真实 SDK context_usage 只有 raw_max_tokens 时圆环仍显示百分比', () => {
    assert.deepEqual(normalizeContextUiState({
        model: 'claude-sonnet-4-6',
        total_tokens: 120000,
        raw_max_tokens: 200000,
        percentage: 60,
    }), {
        totalTokens: 120000,
        maxTokens: 200000,
        rawMaxTokens: 200000,
        percentage: 60,
        state: 'normal',
    })
})

test('compact summary is compact and does not include the full synthesized prompt', () => {
    assert.equal(formatCompactSummary({preTokens: 258731, postTokens: 12160, durationMs: 202263}), '258.7K → 12.2K · 3分22秒')
})

test('SDK 压缩摘要不会作为用户消息显示', () => {
    const compactText = 'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n...'
    assert.equal(isSyntheticCompactUiMessage({
        message: {content: compactText, isCompactSummary: true, isVisibleInTranscriptOnly: true},
    }), true)
    assert.equal(isSyntheticCompactUiMessage({role: 'user', text: compactText}), true)
    assert.equal(isSyntheticCompactUiMessage({role: 'user', text: '请继续完成当前任务'}), false)
})
