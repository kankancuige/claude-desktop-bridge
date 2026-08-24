import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

import {isAutoContinuationPrompt, resolveAutoContinuation} from './task-auto-continuation.mjs'

const maxTurnsResult = {outcome: 'incomplete', continuationReason: 'max_turns'}
const streamRuntimeSource = readFileSync(new URL('../runtime/sdk-stream-runtime.mjs', import.meta.url), 'utf8')
const sessionStopRuntimeSource = readFileSync(new URL('../runtime/session-stop-runtime.mjs', import.meta.url), 'utf8')
const coordinatorSource = readFileSync(new URL('../sessions/session-coordinator.mjs', import.meta.url), 'utf8')
const streamAdapterSource = readFileSync(new URL('../sessions/sdk-stream-adapter.mjs', import.meta.url), 'utf8')

test('max turns 按任务档位限制自动续跑次数', () => {
    const cases = [
        ['light', 1],
        ['balanced', 2],
        ['power', 3],
    ]
    for (const [modelTier, maxAttempts] of cases) {
        const allowed = resolveAutoContinuation({
            result: maxTurnsResult,
            decision: {modelTier},
            attempt: maxAttempts - 1,
            hasConversation: true,
            taskActive: true,
        })
        assert.equal(allowed.shouldContinue, true, modelTier)
        assert.equal(allowed.attempt, maxAttempts, modelTier)
        assert.equal(allowed.maxAttempts, maxAttempts, modelTier)

        const exhausted = resolveAutoContinuation({
            result: maxTurnsResult,
            decision: {modelTier},
            attempt: maxAttempts,
            hasConversation: true,
            taskActive: true,
        })
        assert.equal(exhausted.shouldContinue, false, modelTier)
        assert.equal(exhausted.reason, 'attempt_limit', modelTier)
    }
})

test('只有活跃且可恢复的 max_turns 结果允许自动续跑', () => {
    assert.equal(resolveAutoContinuation({
        result: {outcome: 'failed', continuationReason: 'execution_error'},
        decision: {modelTier: 'power'}, attempt: 0, hasConversation: true, taskActive: true,
    }).shouldContinue, false)
    assert.equal(resolveAutoContinuation({
        result: maxTurnsResult,
        decision: {modelTier: 'power'}, attempt: 0, hasConversation: false, taskActive: true,
    }).reason, 'conversation_unavailable')
    assert.equal(resolveAutoContinuation({
        result: maxTurnsResult,
        decision: {modelTier: 'power'}, attempt: 0, hasConversation: true, taskActive: false,
    }).reason, 'task_inactive')
})

test('显式 session 模式永不自动续跑，workflow 受运行预算限制', () => {
    assert.equal(resolveAutoContinuation({
        result: maxTurnsResult,
        decision: {executionMode: 'session'}, attempt: 0, hasConversation: true, taskActive: true,
    }).reason, 'session_mode')
    const limited = resolveAutoContinuation({
        result: {...maxTurnsResult, usage: {input_tokens: 100, output_tokens: 20}},
        decision: {executionMode: 'workflow', continuationPolicy: {maxRounds: 1, maxTokens: 1000}},
        attempt: 0, hasConversation: true, taskActive: true,
    })
    assert.equal(limited.shouldContinue, true)
    const exhausted = resolveAutoContinuation({
        result: {...maxTurnsResult, usage: {input_tokens: 100, output_tokens: 20}},
        decision: {executionMode: 'workflow', continuationPolicy: {maxRounds: 1, maxTokens: 1000}},
        attempt: 1, budget: limited.budget, hasConversation: true, taskActive: true,
    })
    assert.equal(exhausted.reason, 'max_rounds')
})

test('未知档位使用 balanced 上限且提示不要求用户重复原任务', () => {
    const result = resolveAutoContinuation({
        result: maxTurnsResult,
        decision: {}, attempt: 0, hasConversation: true, taskActive: true,
    })
    assert.equal(result.tier, 'balanced')
    assert.equal(result.maxAttempts, 2)
    assert.equal(isAutoContinuationPrompt(result.prompt), true)
    assert.match(result.prompt, /继续当前尚未完成的任务/)
    assert.match(result.prompt, /不要重新开始/)
})

test('Gateway 自动续跑沿用原 SDK 会话，并在重建完成前串行排队追加消息', () => {
    const start = streamRuntimeSource.indexOf('async function startAutoContinuation')
    const end = streamRuntimeSource.indexOf('async function startStreamPump', start)
    assert.ok(start >= 0 && end > start)
    const rebuild = streamRuntimeSource.slice(start, end)
    assert.match(rebuild, /session\.lastSessionId/)
    assert.match(rebuild, /opts\.resume = session\.lastSessionId/)
    assert.match(rebuild, /maxContextTokens: session\.queryOpts\?\.bridgeContextSafetyCap/)
    assert.match(rebuild, /sessionCoordinator\.beginRebuild\(session, request\.prompt\)/)
    assert.match(rebuild, /sessionCoordinator\.attachPromise\(session, rebuildId, rebuildPromise\)/)
    assert.match(rebuild, /sessionCoordinator\.consumePendingMessages\(session, rebuildId\)/)
    assert.match(rebuild, /session\._autoContinuationRequest !== request/)
    assert.match(rebuild, /session\._autoContinuationRequest = null/)
    assert.match(streamAdapterSource, /isAutoContinuationPrompt\(userText\)/)

    const pumpStart = streamRuntimeSource.indexOf('async function startStreamPump')
    const pumpEnd = streamRuntimeSource.indexOf('return {startStreamPump, startAutoContinuation}', pumpStart)
    const pump = streamRuntimeSource.slice(pumpStart, pumpEnd)
    assert.doesNotMatch(pump, /setImmediate\(\(\) => \{\s*void startAutoContinuation/)
    assert.match(pump, /void startAutoContinuation\(sessionId, s2, autoContinuationRequest\)/)
})

test('停止会话先失效 rebuild token，异步续跑完成后不能复活任务', () => {
    const start = sessionStopRuntimeSource.indexOf('async function stopSessionGeneration')
    const end = sessionStopRuntimeSource.indexOf('return {stopSessionGeneration}', start)
    assert.ok(start >= 0 && end > start)
    const stop = sessionStopRuntimeSource.slice(start, end)
    const invalidate = stop.indexOf("sessionCoordinator.cancel(session, 'stop_generation')")
    const close = stop.indexOf('await closeSessionRuntime')
    assert.ok(invalidate >= 0 && close > invalidate)
    assert.match(stop, /session\._autoContinuationRequest = null/)
    assert.match(coordinatorSource, /invalidate\(session\)/)
    assert.match(coordinatorSource, /session\._rebuildId = null/)
})
