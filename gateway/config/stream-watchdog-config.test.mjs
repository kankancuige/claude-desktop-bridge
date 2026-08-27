import assert from 'node:assert/strict'
import test from 'node:test'
import {normalizeStreamWatchdogConfig, STREAM_WATCHDOG_DEFAULTS} from './stream-watchdog-config.mjs'

test('stream watchdog 配置使用系统设置并限制范围', () => {
    assert.deepEqual(normalizeStreamWatchdogConfig(), STREAM_WATCHDOG_DEFAULTS)
    assert.deepEqual(normalizeStreamWatchdogConfig({idleTimeoutMs: 1, toolIdleTimeoutMs: 999999999, maxDurationMs: 'bad'}), {
        idleTimeoutMs: 30_000, toolIdleTimeoutMs: 7_200_000, maxDurationMs: 7_200_000,
    })
})
