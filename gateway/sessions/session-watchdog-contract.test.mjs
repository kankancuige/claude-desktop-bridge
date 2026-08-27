import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const streamSource = readFileSync(new URL('../runtime/session-input-runtime.mjs', import.meta.url), 'utf8')
const gatewayRuntimeSource = readFileSync(new URL('../gateway-runtime-impl.mjs', import.meta.url), 'utf8')
const watchdogConfigSource = readFileSync(new URL('../config/stream-watchdog-config.mjs', import.meta.url), 'utf8')

test('stream watchdog 覆盖首个 SDK 事件前的活跃 turn/rebuild，不只依赖 generating', () => {
    const start = streamSource.indexOf('function hasActiveStreamWork')
    const end = streamSource.indexOf('return {acceptSessionInput', start)
    assert.ok(start >= 0 && end > start)
    const section = streamSource.slice(start, end)
    assert.match(section, /session\.activeTurnId/)
    assert.match(section, /session\._rebuildPromise/)
    assert.match(section, /session\._pendingInputs\?\.length/)
    assert.match(section, /sessionCoordinator\.isTimeoutCurrent\(session, query\)/)
})

test('stream watchdog 只从系统设置规范化配置，不保留环境变量入口', () => {
    assert.doesNotMatch(gatewayRuntimeSource, /BRIDGE_STREAM_(?:IDLE|TOOL_IDLE|MAX_DURATION)_TIMEOUT_MS/)
    assert.match(gatewayRuntimeSource, /normalizeStreamWatchdogConfig\(loadCliSettings\(\)\.streamWatchdog\)/)
    assert.match(watchdogConfigSource, /idleTimeoutMs: 10 \* 60 \* 1000/)
    assert.match(watchdogConfigSource, /toolIdleTimeoutMs: 30 \* 60 \* 1000/)
    assert.match(watchdogConfigSource, /maxDurationMs: 2 \* 60 \* 60 \* 1000/)
})
