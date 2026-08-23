import test from 'node:test'
import assert from 'node:assert/strict'
import {createRuntimeDiagnostics} from './runtime-diagnostics.mjs'

test('诊断事件只保留有界运行字段并限制 ring buffer', () => {
    let now = 100
    const diagnostics = createRuntimeDiagnostics({maxEvents: 2, now: () => now++})
    diagnostics.record({phase: 'query', durationMs: 12, retryCount: 1, prompt: 'secret', rawPath: 'D:/private'})
    diagnostics.record({phase: 'cleanup', cleanupOutcome: 'cleaned', errorCode: 'none'})
    diagnostics.record({phase: 'timeout', errorCode: 'stream_idle_timeout'})
    const events = diagnostics.snapshot()
    assert.equal(events.length, 2)
    assert.equal(events[0].phase, 'cleanup')
    assert.equal(events[1].errorCode, 'stream_idle_timeout')
    assert.doesNotMatch(JSON.stringify(events), /secret|private|prompt|rawPath/i)
})

test('诊断汇总按 phase 和 errorCode 计数，非法数字保持 null', () => {
    const diagnostics = createRuntimeDiagnostics()
    diagnostics.record({phase: 'query', durationMs: -1, retryCount: 'bad'})
    diagnostics.record({phase: 'query', durationMs: 10, errorCode: 'timeout'})
    assert.deepEqual(diagnostics.summary(), {
        count: 2,
        byPhase: {query: 2},
        byError: {timeout: 1},
    })
    assert.equal(diagnostics.snapshot()[0].durationMs, null)
    assert.equal(diagnostics.snapshot()[0].retryCount, null)
})
